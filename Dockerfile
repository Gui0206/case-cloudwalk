FROM golang:1.25-alpine AS build
WORKDIR /src
COPY backend/go.* ./
RUN go mod download
COPY backend/ .
RUN go test ./... && CGO_ENABLED=0 go build -o /desk .
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY scripts/recovery.js scripts/recovery.js
COPY schema.sql .
COPY public public
COPY --from=build /desk /desk
CMD ["/desk"]
