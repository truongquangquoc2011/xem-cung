# ==========================================================
# Stage 1: Build Frontend (React + TypeScript + Vite)
# ==========================================================
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ==========================================================
# Stage 2: Build Backend (Spring Boot + gộp sẵn Frontend)
# ==========================================================
FROM eclipse-temurin:17-jdk-alpine AS backend-build
WORKDIR /app/backend
COPY backend/.mvn/ .mvn/
COPY backend/mvnw backend/pom.xml ./
RUN chmod +x mvnw && ./mvnw dependency:go-offline -B
COPY backend/src/ src/
# Chép bản build của Frontend vào thư mục static của Spring Boot
COPY --from=frontend-build /app/frontend/dist/ src/main/resources/static/
RUN ./mvnw package -DskipTests -B

# ==========================================================
# Stage 3: Chạy Production nhẹ nhàng (JRE 17)
# ==========================================================
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
COPY --from=backend-build /app/backend/target/*.jar app.jar
EXPOSE 8080
ENV PORT=8080
ENTRYPOINT ["java", "-Xmx384m", "-jar", "app.jar"]
