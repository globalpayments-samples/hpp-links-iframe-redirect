FROM maven:3.9-eclipse-temurin-21 AS builder

WORKDIR /app

# Copy pom.xml and download dependencies
COPY pom.xml .
RUN mvn dependency:go-offline -B

# Copy source code and build
COPY src ./src
RUN mvn clean package -DskipTests

# Runtime stage — deploy the WAR straight to Tomcat.
# (Running `mvn cargo:run` inside a container is unreliable: it dies with
#  NoClassDefFoundError on Cargo's JVM launcher, so the container exits.)
FROM tomcat:10.1-jdk21-temurin

# Serve on 8000 (the port convention shared by every framework) instead of
# Tomcat's default 8080, and install wget for the container healthcheck.
RUN sed -i 's/port="8080"/port="8000"/' /usr/local/tomcat/conf/server.xml && \
    apt-get update && apt-get install -y --no-install-recommends wget && \
    rm -rf /var/lib/apt/lists/*

# Deploy as the ROOT context so /access-token, /process-payment, etc. resolve
# at the server root (matching the Cargo cargo.context=/ that was used before).
RUN rm -rf /usr/local/tomcat/webapps/*
COPY --from=builder /app/target/ROOT.war /usr/local/tomcat/webapps/ROOT.war

EXPOSE 8000

CMD ["catalina.sh", "run"]