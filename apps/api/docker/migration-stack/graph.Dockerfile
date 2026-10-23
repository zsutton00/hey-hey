# syntax=docker/dockerfile:1

FROM eclipse-temurin:17-jdk AS dependencies

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends maven \
    && rm -rf /var/lib/apt/lists/*

COPY --from=graph /pom.xml ./pom.xml

# Resolve from the POM alone; changing contracts or source must not rerun this.
RUN --mount=type=cache,id=heyhey-migration-maven,target=/root/.m2,sharing=locked \
    mvn dependency:go-offline -B -Dopenapi.root=/openapi

FROM dependencies AS build

COPY --from=openapi /specs /openapi/specs
COPY --from=graph /scripts ./scripts
COPY --from=graph /src ./src

# Use the same repository cache for plugins resolved during compilation too.
RUN --mount=type=cache,id=heyhey-migration-maven,target=/root/.m2,sharing=locked \
    mvn clean package -DskipTests -Dopenapi.root=/openapi

FROM eclipse-temurin:17-jre

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1001 spring \
    && useradd --uid 1001 --gid spring --shell /bin/sh --create-home spring

COPY --from=graph /docker/docker-entrypoint.sh /app/docker-entrypoint.sh
COPY --from=build /app/target/*.jar /app/app.jar

RUN chmod +x /app/docker-entrypoint.sh && chown -R spring:spring /app

USER spring:spring

ENV SPRING_PROFILES_ACTIVE=dev,container

EXPOSE 8081

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["java", "-jar", "/app/app.jar"]
