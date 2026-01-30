# ⚡ Brain Hop - Backend API

![Banner](https://via.placeholder.com/1200x350/0f172a/FFFFFF?text=Brain+Hop+Backend+API)

> **The high-performance API Gateway and RAG Engine powering Brain Hop.**
> *Orchestrates authentication, vector storage, and huge context retrieval.*

<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-18-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?style=for-the-badge&logo=express&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=for-the-badge&logo=python&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Storage-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)

</div>

---

## 📖 Table of Contents
- [🏗️ Architecture](#-architecture)
- [🐳 Docker Setup (Recommended)](#-docker-setup-recommended)
- [🔧 Manual Setup](#-manual-setup)
- [🔌 API Reference](#-api-reference)
- [🧪 Testing Strategy](#-testing-strategy)

---

## 🏗️ Architecture

The backend consists of **two microservices**:

1.  **API Gateway (`Node.js/Express`)** - Port `3001`
    - Handles HTTP requests from the frontend.
    - Manages Authentication (Supabase Auth).
    - Proxies complex AI tasks to the Python service.
    
2.  **RAG Engine (`Python/Flask`)** - Port `5001`
    - Uses **LangChain** and **ChromaDB**.
    - Handles Document Parsing, Vector Embeddings (HuggingFace), and Retrieval.
    - Persists vector stores to Supabase Storage as zipped artifacts.

---

## 🐳 Docker Setup (Recommended)

The easiest way to run the entire backend stack.

### 1️⃣ Prerequisites
- Docker Desktop installed and running.
- A `.env` file in the root directory (see `.env.example`).

### 2️⃣ Start Services
Run the following command in the `Brain-Hop-API` root:

```bash
docker-compose up --build
```

### 🔍 What happens next?
- **Builds** the Python image (`chatbot/Dockerfile`).
- **Builds** the Node image (`Dockerfile`).
- **Starts** both containers.
- **Hot Reloading**: 
    - The Node API uses `nodemon` (via `npx`). Changes to `server.js` will restart it properly.
    - The Python Chatbot mounts the volume. Changes to `main.py` will trigger a reload (Flask debug mode).

### 🛑 Stop Services
```bash
docker-compose down
```

---

## 🔧 Manual Setup

If you prefer running without Docker.

### 1️⃣ Node.js Gateway
```bash
# Install dependencies
npm install

# Start Server (Use 'dev' for hot reload)
npm run start
# Server runs at http://localhost:3001
```

### 2️⃣ Python Chatbot
**Note**: Requires Python 3.11+.

```bash
cd chatbot

# Create venv (Recommended)
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows

# Install Dependencies
pip install -r requirements.txt

# Start Flask App
python main.py
# Server runs at http://localhost:5001
```

---

## 🔌 API Reference

### 🟢 Status
- **`GET /health`**
  - Returns `200 OK` if the Node server is running.

### 🤖 Chat Operations (Node Proxy -> Python)

- **`POST /api/chat`**
  - **Body**: `{ "message": "Hello", "history": [...] }`
  - **Description**: Sends user message to RAG engine. Logic:
    1. Node receives request.
    2. Downloads vector store from Supabase (if exists).
    3. Forwards to Python (`http://localhost:5001/chat`).
    4. Python generates response using LangChain.

- **`POST /api/chat/close`**
  - **Body**: `{ "chatId": "123", "userId": "user_abc" }`
  - **Description**: Triggers persistence. The current in-memory vector store is zipped and uploaded to Supabase Storage.

- **`POST /api/chat/merge`**
  - **Body**: `{ "chatIds": ["id1", "id2"] }`
  - **Description**: Merges two vector stores into a new session context.

---

## 🧪 Testing Strategy

### 🟢 Node.js Tests (Jest)
Located in `tests/`. Covers authentication and routine proxy logic.

```bash
npm run test
```

### 🐍 Python Tests (Pytest in Docker)
Located in `chatbot/tests/`. Covers RAG logic, API endpoints, and File I/O.
**We run these in Docker** to skip installing 2GB+ of ML libraries (PyTorch/Transformers) on your local machine.

**How to run:**
1.  Navigate to `chatbot/`.
2.  Run the helper script:

```cmd
test_docker.bat
```

**What this script does:**
1.  Builds a lightweight Docker image (`chatbot-test-light`).
2.  Installs only test dependencies (flask, pytest, mocks).
3.  Runs `pytest`.
4.  Deletes the container and image.

> ✅ **All tests are mocked!** No real API calls are made to OpenAI or Supabase ensuring fast and free execution.
