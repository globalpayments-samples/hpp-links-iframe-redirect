#!/bin/bash

# Docker management script for payment implementations

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_usage() {
    echo "Usage: $0 {build|start|stop|test|logs|clean|status}"
    echo ""
    echo "Commands:"
    echo "  build       - Build all Docker images"
    echo "  start       - Start all payment services"
    echo "  stop        - Stop all services"
    echo "  test        - Run E2E tests against containers"
    echo "  test:single - Run tests for a single implementation"
    echo "  logs        - Show logs from all services"
    echo "  clean       - Remove all containers and images"
    echo "  status      - Show status of all services"
    echo ""
    echo "Examples:"
    echo "  $0 build"
    echo "  $0 start"
    echo "  $0 test"
    echo "  $0 test:single nodejs"
    echo "  $0 logs nodejs"
}

check_env() {
    if [ ! -f .env ]; then
        echo -e "${RED}❌ .env file not found${NC}"
        echo -e "${YELLOW}Please create .env file with your GP API credentials:${NC}"
        echo "GP_APP_ID=your_app_id"
        echo "GP_APP_KEY=your_app_key"
        echo "GP_MERCHANT_ID=your_merchant_id"
        echo "GP_ACCOUNT_NAME=transaction_processing"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Environment file found${NC}"
}

build_images() {
    echo -e "${BLUE}🔨 Building Docker images...${NC}"
    docker-compose build --parallel
    echo -e "${GREEN}✅ All images built successfully${NC}"
}

start_services() {
    echo -e "${BLUE}🚀 Starting payment services...${NC}"
    docker-compose up -d nodejs python php java dotnet

    echo -e "${YELLOW}⏳ Waiting for services to be healthy...${NC}"
    docker-compose ps

    echo -e "${GREEN}✅ All services started${NC}"
    echo ""
    echo "Services available at:"
    echo "  Node.js: http://localhost:8001"
    echo "  Python:  http://localhost:8002"
    echo "  PHP:     http://localhost:8003"
    echo "  Java:    http://localhost:8004"
    echo "  .NET:    http://localhost:8006"
}

stop_services() {
    echo -e "${BLUE}🛑 Stopping all services...${NC}"
    docker-compose down
    echo -e "${GREEN}✅ All services stopped${NC}"
}

run_tests() {
    echo -e "${BLUE}🧪 Running E2E tests...${NC}"
    
    # Make sure test output directories exist
    mkdir -p test-results playwright-report
    
    # Start services if not running
    echo -e "${YELLOW}📋 Ensuring services are running...${NC}"
    docker-compose up -d nodejs python php java dotnet

    # Wait for services to be healthy
    echo -e "${YELLOW}⏳ Waiting for services to be ready...${NC}"
    sleep 30
    
    # Run tests
    docker-compose --profile testing up --build tests
    
    echo -e "${GREEN}✅ Tests completed${NC}"
    echo "Test results available in ./test-results/"
    echo "HTML report available in ./playwright-report/"
}

run_single_test() {
    local impl=$1
    if [ -z "$impl" ]; then
        echo -e "${RED}❌ Please specify implementation: nodejs, python, php, java, or dotnet${NC}"
        exit 1
    fi
    
    echo -e "${BLUE}🧪 Running tests for ${impl}...${NC}"
    
    # Start specific service
    docker-compose up -d $impl
    
    # Run tests with filter
    IMPLEMENTATION_FILTER=$impl docker-compose --profile testing up --build tests
}

show_logs() {
    local service=$1
    if [ -z "$service" ]; then
        echo -e "${BLUE}📋 Showing logs for all services...${NC}"
        docker-compose logs -f
    else
        echo -e "${BLUE}📋 Showing logs for ${service}...${NC}"
        docker-compose logs -f $service
    fi
}

clean_all() {
    echo -e "${YELLOW}⚠️  This will remove all containers, images, and volumes${NC}"
    read -p "Are you sure? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${BLUE}🧹 Cleaning up...${NC}"
        docker-compose down -v --rmi all --remove-orphans
        docker system prune -f
        echo -e "${GREEN}✅ Cleanup completed${NC}"
    else
        echo -e "${YELLOW}❌ Cleanup cancelled${NC}"
    fi
}

show_status() {
    echo -e "${BLUE}📊 Service Status:${NC}"
    docker-compose ps
    echo ""
    echo -e "${BLUE}💾 Images:${NC}"
    docker images | grep -E "(payments|test)" || echo "No images found"
}

# Main script logic
case "$1" in
    build)
        check_env
        build_images
        ;;
    start)
        check_env
        start_services
        ;;
    stop)
        stop_services
        ;;
    test)
        check_env
        run_tests
        ;;
    test:single)
        check_env
        run_single_test $2
        ;;
    logs)
        show_logs $2
        ;;
    clean)
        clean_all
        ;;
    status)
        show_status
        ;;
    *)
        print_usage
        exit 1
        ;;
esac