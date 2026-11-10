FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.* ./
RUN go mod download
COPY main.go .
RUN CGO_ENABLED=0 go build -o /worker .
FROM scratch
COPY --from=build /worker /worker
USER 65532
ENTRYPOINT ["/worker"]
