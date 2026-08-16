.PHONY: localMac prod down logs help vectorStore

help:
	@echo "make localMac    - build and run on Docker Desktop (Mac), published ports, .env.localMac"
	@echo "make prod        - build and run on the 42AI host, network_mode: host, .env.prod"
	@echo "make down        - stop and remove both containers"
	@echo "make logs        - tail logs for both services"
	@echo "make vectorStore - regenerate backend/data/vector_store.json (requires backend container running)"

localMac:
	docker compose -f docker-compose.yml -f docker-compose.localmac.yml --env-file .env.localMac up -d --build

prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod up -d --build

down:
	docker compose down

logs:
	docker compose logs -f

vectorStore:
	docker compose exec backend node scripts/generateVectorStore.js
