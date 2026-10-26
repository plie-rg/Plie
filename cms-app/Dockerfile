FROM python:3.11-slim
WORKDIR /app
COPY cms-app/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
COPY . /app
ENV CMS_BIND_HOST=0.0.0.0 CMS_DATA=/data PYTHONUNBUFFERED=1
RUN useradd --uid 10001 --create-home plie && mkdir /data && chown plie:plie /data
USER plie
EXPOSE 8766
VOLUME ["/data"]
CMD ["python", "cms-app/app.py"]
