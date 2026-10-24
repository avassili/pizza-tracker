#!/usr/bin/env bash
# Creates PizzaTrackerDev on DynamoDB Local (idempotent).
set -euo pipefail

ENDPOINT="${DYNAMODB_ENDPOINT:-http://dynamodb-local:8000}"
TABLE="${DYNAMODB_TABLE_NAME:-PizzaTrackerDev}"

echo "Waiting for DynamoDB Local at ${ENDPOINT}..."
for i in $(seq 1 30); do
  if aws dynamodb list-tables --endpoint-url "${ENDPOINT}" --region "${AWS_REGION:-us-east-1}" >/dev/null 2>&1; then
    break
  fi
  if [[ "$i" -eq 30 ]]; then
    echo "DynamoDB Local did not become ready in time." >&2
    exit 1
  fi
  sleep 1
done

EXISTING="$(aws dynamodb list-tables --endpoint-url "${ENDPOINT}" --output text --query 'TableNames' 2>/dev/null || true)"
if echo "${EXISTING}" | grep -qw "${TABLE}"; then
  echo "Table ${TABLE} already exists — skipping create."
  aws dynamodb describe-table --endpoint-url "${ENDPOINT}" --table-name "${TABLE}" --query 'Table.[TableName,TableStatus,GlobalSecondaryIndexes[*].IndexName]' --output table
  exit 0
fi

echo "Creating table ${TABLE}..."
aws dynamodb create-table \
  --endpoint-url "${ENDPOINT}" \
  --table-name "${TABLE}" \
  --billing-mode PROVISIONED \
  --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=SK,AttributeType=S \
    AttributeName=GSI1PK,AttributeType=S \
    AttributeName=GSI1SK,AttributeType=S \
    AttributeName=GSI2PK,AttributeType=S \
    AttributeName=GSI2SK,AttributeType=S \
  --key-schema \
    AttributeName=PK,KeyType=HASH \
    AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes '[
    {
      "IndexName": "GSI1",
      "KeySchema": [
        {"AttributeName":"GSI1PK","KeyType":"HASH"},
        {"AttributeName":"GSI1SK","KeyType":"RANGE"}
      ],
      "Projection": {"ProjectionType":"ALL"},
      "ProvisionedThroughput": {"ReadCapacityUnits":5,"WriteCapacityUnits":5}
    },
    {
      "IndexName": "GSI2",
      "KeySchema": [
        {"AttributeName":"GSI2PK","KeyType":"HASH"},
        {"AttributeName":"GSI2SK","KeyType":"RANGE"}
      ],
      "Projection": {"ProjectionType":"ALL"},
      "ProvisionedThroughput": {"ReadCapacityUnits":5,"WriteCapacityUnits":5}
    }
  ]' >/dev/null

aws dynamodb wait table-exists --endpoint-url "${ENDPOINT}" --table-name "${TABLE}"
echo "Table ${TABLE} is ACTIVE."
