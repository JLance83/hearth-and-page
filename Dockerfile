FROM node:20-slim

# Install Python 3 and pip
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install pypdf and cryptography (needed for AES-encrypted PDFs)
RUN pip3 install --no-cache-dir pypdf cryptography --break-system-packages

WORKDIR /app

# Copy package files and install Node deps
COPY package*.json ./
RUN npm install --production

# Copy the rest of the app
COPY . .

# Run the patch scripts (they modify dist/index.cjs and dist/public/)
RUN node patch-frontend.cjs && node patch-server.cjs

# Copy fill_pdf.py to dist/
RUN cp fill_pdf.py dist/fill_pdf.py

# Verify python3 is available
RUN python3 --version && python3 -c "import pypdf; print('pypdf OK')"

EXPOSE 8080

CMD ["node", "dist/index.cjs"]
