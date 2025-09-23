# MariaDB Database Query System Instructions

## Database Configuration
**ALWAYS use database: information_schema**

## General Principles

### 1. Database Selection
- All MariaDB queries MUST target the information_schema database
- Use table name (cloudaccount)

### 2. Query Patterns for Account Lookups

#### Name-based Lookups
```sql
SELECT id COALESCE(deleted_at, 0) AS deleted_at FROM \`my-db\`.cloudaccount LIKE '%search_term%' AND (deleted_at = 0 OR deleted_at IS NULL) ORDER BY id ;
```

## Table Structure Guidelines

### Common Tables and Fields

#### cloudaccount Table
- `id`: Primary account identifier
- `name`: cloud name

## Query Optimization

### 1. Use Indexes
- Query by indexed fields (id) when possible
- Use EXPLAIN to verify query performance

### 2. Limit Results
- Add LIMIT clause for large result sets
- Use pagination for browsing data

### 3. Precise Filters
- Use exact matches when ID is known
- Use LIKE only for partial name searches

## Response Formatting

### For ID Lookups
When returning IDs, always:
1. State clearly what was found
2. Display the ID prominently using **bold** formatting
3. Include related fields (name)
4. Offer follow-up actions
5. Status: Active (Not deleted, deleted_at: 0)

Example response format:
"Found the account for [Name]. **Account ID: 12345**
- Email: user@example.com
- Status: Active"

### For Multiple Results
- Show count of results found
- Display key fields in a table or list format
- Suggest refinement options if too many results

## Security Guidelines

### Read-Only by Default
- Default to SELECT queries
- Never run UPDATE, DELETE, DROP without explicit confirmation

### Input Validation
- Escape special characters in user input
- Use parameterized queries when possible
- Validate ID formats before querying

## Common Query Templates

### Find account by partial name
```sql
SELECT id, name,
COALESCE(deleted_at, 0) AS deleted_at
FROM `my-db`.cloudaccount
WHERE cloudaccount LIKE '%search_term%'
AND (deleted_at = 0 OR deleted_at IS NULL)
ORDER BY name
LIMIT 10;
```