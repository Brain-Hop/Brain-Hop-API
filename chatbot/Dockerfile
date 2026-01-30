FROM python:3.11-slim

WORKDIR /app

# Ensure logs appear immediately
ENV PYTHONUNBUFFERED=1

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Expose port 5001 (as seen in main.py)
EXPOSE 5001

CMD ["python", "main.py"]
