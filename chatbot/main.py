from flask import Flask, jsonify, request
from dotenv import load_dotenv
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import Chroma
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_classic.chains.combine_documents import create_stuff_documents_chain
from langchain_classic.chains import create_retrieval_chain
from supabase import create_client
import os, shutil, zipfile, time, base64, threading, contextlib

# =========================================================
# SETUP
# =========================================================
load_dotenv()
app = Flask(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
if not OPENROUTER_API_KEY:
    raise ValueError("⚠️ Missing OPENROUTER_API_KEY in .env file!")

os.environ["OPENAI_API_KEY"] = OPENROUTER_API_KEY
os.environ["OPENAI_API_BASE"] = "https://openrouter.ai/api/v1"

# -------------------- EMBEDDINGS --------------------
print("⏳ Initializing Embedding Model (this may take a while on first run)...", flush=True)
embedding_model = HuggingFaceEmbeddings(
    model_name="sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
)
print("✅ Embedding Model Loaded!", flush=True)

loaded_vectorstores = {}
chat_history = {}
loaded_vectorstores = {}
chat_history = {}
last_active = {}
chat_locks = {}  # Stores threading.Lock() for each (user_id, chat_id)

# =========================================================
# HELPERS
# =========================================================
@contextlib.contextmanager
def get_chat_lock(user_id, chat_id):
    key = (user_id, chat_id)
    if key not in chat_locks:
        chat_locks[key] = threading.Lock()
    
    lock = chat_locks[key]
    lock.acquire()
    try:
        yield
    finally:
        lock.release()

def local_dir(user_id, chat_id):
    return os.path.join("/tmp", f"vector_store_{user_id}_{chat_id}")

def vector_zip_name(user_id, chat_id):
    return f"{user_id}_{chat_id}_chat_memory.zip"

def split_text(text, chunk_size=500, overlap=100):
    splitter = RecursiveCharacterTextSplitter(chunk_size=chunk_size, chunk_overlap=overlap)
    return splitter.split_text(text)

def get_recent_chat_context(user_id, chat_id, n_turns=5):
    key = (user_id, chat_id)
    if key not in chat_history:
        return ""
    msgs = chat_history[key][-n_turns * 2:]
    return "\n".join([f"{m['role'].capitalize()}: {m['text']}" for m in msgs])

def download_image_from_supabase(image_name):
    try:
        res = supabase.storage.from_("chat_vectors").download(image_name)
        if not res:
            raise ValueError("No image data returned from Supabase")

        temp_dir = "/tmp/temp_images"
        os.makedirs(temp_dir, exist_ok=True)
        local_path = os.path.join(temp_dir, os.path.basename(image_name))
        with open(local_path, "wb") as f:
            f.write(res)
        image_b64 = base64.b64encode(res).decode("utf-8")
        print(f"🖼️ Downloaded image: {image_name}")
        return {"local_path": local_path, "b64": image_b64}
    except Exception as e:
        print(f"❌ Failed to download image: {e}")
        return None

def cleanup_temp_images(delay=180):
    time.sleep(delay)
    shutil.rmtree("/tmp/temp_images", ignore_errors=True)

# =========================================================
# VECTORSTORE MANAGEMENT
# =========================================================
def load_vectorstore_from_supabase(user_id, chat_id):
    key = (user_id, chat_id)
    if key in loaded_vectorstores:
        last_active[key] = time.time()
        return loaded_vectorstores[key]

    local_path = local_dir(user_id, chat_id)
    zip_path = f"{local_path}.zip"

    try:
        print(f"📥 Downloading {vector_zip_name(user_id, chat_id)} from Supabase...")
        # Clean up any existing directory to avoid conflicts
        shutil.rmtree(local_path, ignore_errors=True)
        
        with open(zip_path, "wb") as f:
            res = supabase.storage.from_("chat_vectors").download(vector_zip_name(user_id, chat_id))
            f.write(res)
        with zipfile.ZipFile(zip_path, "r") as z:
            z.extractall(local_path)
        os.remove(zip_path)
        print(f"✅ Loaded existing DB for {user_id}-{chat_id}")
    except Exception as e:
        print(f"⚠️ No previous DB for {user_id}-{chat_id}: {e}")
        os.makedirs(local_path, exist_ok=True)

    vs = Chroma(persist_directory=local_path, embedding_function=embedding_model)
    loaded_vectorstores[key] = vs
    chat_history.setdefault(key, [])
    last_active[key] = time.time()
    return vs

def persist_and_upload_vectorstore(user_id, chat_id):
    with get_chat_lock(user_id, chat_id):
        key = (user_id, chat_id)
    if key not in loaded_vectorstores:
        return {"error": "no vectorstore found"}

    local_path = local_dir(user_id, chat_id)
    zip_path = f"{local_path}.zip"
    vs = loaded_vectorstores[key]
    vs.persist()
    shutil.make_archive(local_path, "zip", local_path)

    with open(zip_path, "rb") as f:
        supabase.storage.from_("chat_vectors").upload(
            vector_zip_name(user_id, chat_id),
            f,
            {"x-upsert": "true"}
        )

    print(f"💾 Uploaded DB for {user_id}-{chat_id}")
    shutil.rmtree(local_path, ignore_errors=True)
    os.remove(zip_path)
    del loaded_vectorstores[key]
    del chat_history[key]
    last_active.pop(key, None)
    return {"status": "uploaded"}

# =========================================================
# MESSAGE HANDLING
# =========================================================
def add_message(user_id, chat_id, role, text, has_image=False, image_name=None):
    key = (user_id, chat_id)
    chat_history.setdefault(key, [])
    chat_number = len(chat_history[key]) + 1
    msg = {
        "role": role,
        "text": text,
        "chat_number": chat_number,
        "has_image": has_image,
        "image_name": image_name,
        "ts": int(time.time())
    }
    chat_history[key].append(msg)

    with get_chat_lock(user_id, chat_id):
        vs = load_vectorstore_from_supabase(user_id, chat_id)
        chunks = split_text(f"[{chat_number}] {role}: {text}")
        docs = [Document(page_content=c, metadata={"role": role, "chat_number": chat_number}) for c in chunks]
        vs.add_documents(docs)
        last_active[key] = time.time()

# =========================================================
# RAG PIPELINE + IMAGE CAPTION
# =========================================================
def describe_image_with_openrouter(image_b64):
    try:
        llm = ChatOpenAI(
            model="gpt-4o-mini",
            openai_api_base="https://openrouter.ai/api/v1",
            openai_api_key=OPENROUTER_API_KEY,
            temperature=0.2
        )
        multimodal_prompt = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Describe this image in detail:"},
                    {"type": "image_url", "image_url": f"data:image/png;base64,{image_b64}"}
                ]
            }
        ]
        result = llm.invoke(multimodal_prompt)
        if hasattr(result, "content"):
            return result.content.strip()
        return "No description generated."
    except Exception as e:
        print("❌ Image captioning failed:", e)
        return "Error describing image."

def build_rag_chain(vectorstore, model_name):
    retriever = vectorstore.as_retriever(search_kwargs={"k": 4})
    llm = ChatOpenAI(
        model=model_name,
        openai_api_base="https://openrouter.ai/api/v1",
        openai_api_key=OPENROUTER_API_KEY,
        temperature=0.3
    )
    prompt = ChatPromptTemplate.from_template(
        """You are a multilingual multimodal contextual AI assistant.
Use retrieved context, chat history, and any image info.

Chat History:
{chat_history}

Retrieved Memory:
{context}

User Query:
{input}

Assistant:"""
    )
    combine_chain = create_stuff_documents_chain(llm, prompt)
    return create_retrieval_chain(retriever, combine_chain)

# =========================================================
# /CHAT ENDPOINT
# =========================================================
@app.route("/chat", methods=["POST"])
def chat():
    data = request.get_json()
    user_id = data.get("user_id")
    chat_id = data.get("chat_id")
    model_name = data.get("model_name")
    question = data.get("question")
    has_image = str(data.get("has_image", "false")).lower() == "true"
    image_name = data.get("image_name")

    if not all([user_id, chat_id, model_name, question]):
        return jsonify({"error": "Missing fields"}), 400

    # vs loading moved inside locks where needed, except for initial read if safe
    # actually, load_vectorstore_from_supabase modifies global loaded_vectorstores, so we should allow it to be called safely.
    # But here we are just reading vs for RAG chain. The RAG chain itself reads from VS.
    
    # We will lock the critical section of adding the message and updating the vectorstore.
    # The read (building RAG chain and invoking it) might also need locking if ChromaDB doesn't support concurrent read/write well,
    # but the error reported was specifically about WRITING to a readonly database (likely moved/deleted).
    
    # Let's lock the whole interaction for safety for now, or at least the write parts.
    # Optimally: lock for add_message (write), lock for RAG (read) if strict.
    # Given the previous error was on 'upsert' inside add_documents, let's look at add_message usage.
    
    image_caption = ""

    if has_image and image_name:
        image_data = download_image_from_supabase(image_name)
        if image_data:
            image_caption = describe_image_with_openrouter(image_data["b64"])
            question += f"\n\n[Attached Image: {image_name}]\n[Image Description: {image_caption}]"

    add_message(user_id, chat_id, "user", question, has_image, image_name)
    if image_caption:
        add_message(user_id, chat_id, "assistant", f"Image Description: {image_caption}")

    # Re-acquire lock for reading to be safe against concurrent deletions
    with get_chat_lock(user_id, chat_id):
        vs = load_vectorstore_from_supabase(user_id, chat_id)
        rag_chain = build_rag_chain(vs, model_name)
        chat_context = get_recent_chat_context(user_id, chat_id)

        try:
            rag_input = {"input": f"{chat_context}\n\n{question}", "chat_history": chat_context}
            result = rag_chain.invoke(rag_input)
            response = result.get("answer", "").strip()
        except Exception as e:
            print("❌ RAG Error:", e)
            response = "Sorry, something went wrong while processing your request."

    add_message(user_id, chat_id, "assistant", response)
    threading.Thread(target=cleanup_temp_images, daemon=True).start()

    return jsonify({
        "response": response,
        "image_description": image_caption,
        "history": chat_history[(user_id, chat_id)]
    })

# =========================================================
# /MERGE_CHATS ENDPOINT
# =========================================================
@app.route("/merge_chats", methods=["POST"])
def merge_chats():
    data = request.get_json()
    user_id = data.get("user_id")
    new_chat_id = data.get("new_chat_id")
    merge_chat_ids = data.get("merge_chat_ids", [])

    if not user_id or not new_chat_id or not merge_chat_ids:
        return jsonify({"error": "Missing required fields"}), 400

    # Ensure we don't have a stale loaded VS for the new chat
    key = (user_id, new_chat_id)
    if key in loaded_vectorstores:
        del loaded_vectorstores[key]
    if key in chat_history:
        del chat_history[key]

    # We lock the target chat ID during creation to prevent race conditions
    with get_chat_lock(user_id, new_chat_id):
        # Use a true temporary directory to avoid colliding with any "active" chat path
        # causing "database is locked" or "readonly" errors if add_message tries to read it.
        temp_merge_dir = os.path.join("/tmp", f"merge_{user_id}_{new_chat_id}_{int(time.time())}")
        os.makedirs(temp_merge_dir, exist_ok=True)
        
        merged_vs = Chroma(persist_directory=temp_merge_dir, embedding_function=embedding_model)

        print(f"🔄 Merging chats {merge_chat_ids} → {new_chat_id}")
        for cid in merge_chat_ids:
            # Lock each source chat while reading
            with get_chat_lock(user_id, cid):
                try:
                    temp_vs = load_vectorstore_from_supabase(user_id, cid)
                    docs = temp_vs.get(include=["metadatas", "documents"])
                    if docs["documents"]:
                        all_docs = [Document(page_content=d, metadata=m) for d, m in zip(docs["documents"], docs["metadatas"])]
                        merged_vs.add_documents(all_docs)
                        print(f"✅ Added {len(all_docs)} docs from {cid}")
                except Exception as e:
                    print(f"⚠️ Failed to merge {cid}: {e}")

        merged_vs.persist()
        # DO NOT add to loaded_vectorstores here because we are about to delete the directory!
        
        shutil.make_archive(temp_merge_dir, "zip", temp_merge_dir)
        with open(f"{temp_merge_dir}.zip", "rb") as f:
            supabase.storage.from_("chat_vectors").upload(
                vector_zip_name(user_id, new_chat_id), f, {"x-upsert": "true"}
            )

        print(f"💾 Uploaded merged DB for {user_id}-{new_chat_id}")
        shutil.rmtree(temp_merge_dir, ignore_errors=True)
        os.remove(f"{temp_merge_dir}.zip")

    return jsonify({"status": "merged", "new_chat_id": new_chat_id})

# =========================================================
# /CLOSE_CHAT ENDPOINT
# =========================================================
@app.route("/close_chat", methods=["POST"])
def close_chat():
    data = request.get_json()
    user_id = data.get("user_id")
    chat_id = data.get("chat_id")
    if not user_id or not chat_id:
        return jsonify({"error": "Missing user_id/chat_id"}), 400
    return jsonify(persist_and_upload_vectorstore(user_id, chat_id))

# =========================================================
# RUN
# =========================================================
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
