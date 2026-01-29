FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /cal_view .

FROM alpine:latest
RUN apk --no-cache add ca-certificates

WORKDIR /app
COPY --from=build /cal_view /usr/local/bin/cal_view
COPY dist ./dist
RUN mkdir -p /data && chmod 700 /data

ENV STATIC_DIR=/app/dist DATA_DIR=/data
EXPOSE 3000
CMD ["cal_view"]
