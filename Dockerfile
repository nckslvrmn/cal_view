FROM alpine:latest
RUN apk --no-cache add ca-certificates darkhttpd

WORKDIR /app
COPY dist .
RUN mkdir -p /data && chmod 755 /data

EXPOSE 3000
CMD ["darkhttpd", "/app", "--port", "3000", "--addr", "0.0.0.0"]
