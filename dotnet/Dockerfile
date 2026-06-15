FROM mcr.microsoft.com/dotnet/sdk:9.0 AS builder

WORKDIR /app

# Copy project file and restore dependencies
COPY *.csproj .
RUN dotnet restore

# Copy source code and build
COPY . .
RUN dotnet publish -c Release -o out

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:9.0

WORKDIR /app

# Copy built application
COPY --from=builder /app/out .

# wget is needed for the container healthcheck (not in the aspnet image)
RUN apt-get update && apt-get install -y --no-install-recommends wget && \
    rm -rf /var/lib/apt/lists/*

# The aspnet:9.0 image ships a built-in non-root `app` user
USER app

EXPOSE 8000

ENV ASPNETCORE_URLS=http://+:8000

CMD ["dotnet", "dotnet.dll"]