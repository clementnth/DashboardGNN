FROM python:3.11-slim

# Set up the working directory
WORKDIR /code

# Copy requirements and install dependencies
COPY ./requirements.txt /code/requirements.txt
RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt

# Create a non-root user (Hugging Face Spaces requirement)
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
	PATH=/home/user/.local/bin:$PATH

WORKDIR $HOME/app

# Copy the rest of the application files
COPY --chown=user . $HOME/app

# Hugging Face Spaces exposes port 7860
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
