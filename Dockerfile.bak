FROM node:20-slim

# Install Python 3 and pip with virtual environment support
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Create a virtual environment and install pypdf
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir pypdf cryptography

ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

# Copy package files and install Node deps
COPY package*.json ./
RUN npm install --production

# Copy the rest of the app
COPY . .

# Run the patch scripts (they modify dist/index.cjs and dist/public/)
RUN node patch-frontend.cjs || true
RUN node patch-server.cjs || true

# Copy fill_pdf.py to dist/
RUN cp fill_pdf.py dist/fill_pdf.py

# Verify python3 is available
RUN python3 --version && python3 -c "import pypdf; print('pypdf OK')"

EXPOSE 8080

CMD ["node", "dist/index.cjs"]
