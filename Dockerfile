FROM ubuntu:latest

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    python3.10 \
    python3-pip \
    git \
    && rm -rf /var/lib/apt/lists/*                                                                                                    

RUN python3.10 -m pip install --upgrade pip setuptools wheel

WORKDIR /app

COPY requirements.txt /app/                

RUN python3.10 -m pip install -r requirements.txt

  
COPY . /app

RUN ln -s /usr/bin/python3 /usr/bin/python
    
RUN cp .env.example .env

RUN pip check

CMD ["bash"]
