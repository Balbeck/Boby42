.PHONY: localMac prod down logs help vectorStore subjectsPdfVectorStore db-migrate db-seed psql check-env-lab test testsFront testsBack

help:
	@echo "make localMac    - build and run on Docker Desktop (Mac), published ports, .env.localMac + .env.lab"
	@echo "make prod        - build and run on the 42AI host, network_mode: host, .env.prod + .env.lab"
	@echo "make down        - stop and remove all containers"
	@echo "make logs        - tail logs for all services"
	@echo "make db-migrate  - apply pending Sequelize migrations (backend container must be running)"
	@echo "make db-seed     - upsert the /lab user from .env.lab (also done automatically at backend boot)"
	@echo "make psql        - open a psql shell on the postgres container"
	@echo "make vectorStore - regenerate backend/data/vector_store.json (requires backend container running)"
	@echo "make subjectsPdfVectorStore - regenerate backend/data/subjectsPdf_vector_store.json from subjectsPdfQuestions.json (requires backend container running)"
	@echo "make test        - run testsFront and testsBack"
	@echo "make testsFront  - run the frontend test suite (npm run test in frontend/)"
	@echo "make testsBack   - backend tests (not implemented yet)"

check-env-lab:
	@test -f .env.lab || { \
	  echo "ERROR: .env.lab is missing (it is git-ignored — not pulled with the repo)."; \
	  echo "Create it from the template and fill it in:"; \
	  echo "  cp .env.lab.example .env.lab && \$$EDITOR .env.lab"; \
	  exit 1; }

localMac: check-env-lab
	docker compose -f docker-compose.yml -f docker-compose.localmac.yml --env-file .env.localMac --env-file .env.lab up -d --build

prod: check-env-lab
	docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod --env-file .env.lab up -d --build

down:
	docker compose down

logs:
	docker compose logs -f

# --env-file .env.lab only so Compose can resolve POSTGRES_PASSWORD (no default)
# when it parses the compose file for `exec`; the target containers are already
# running, mode-agnostic.
db-migrate:
	docker compose --env-file .env.lab exec backend node db/migrate.js

db-seed:
	docker compose --env-file .env.lab exec backend node db/seed.js

psql:
	docker compose --env-file .env.lab exec postgres psql -U boby42 -d boby42

vectorStore:
	docker compose --env-file .env.lab exec backend node scripts/generateVectorStore.js

subjectsPdfVectorStore:
	docker compose --env-file .env.lab exec backend node scripts/generateSubjectsPdfVectorStore.js

test: testsFront testsBack

testsFront:
	cd frontend && npm run test

testsBack:
	@echo "🚧 Test Backend to implement !"
