# RestAPI Database Query System Instructions

These instructions outline the best practices for querying the `restapi` MongoDB database, which contains collections related to cloud cost management, security, and asset tracking. By following these guidelines, you will efficiently extract and present data while adhering to the optimal practices for performance and accuracy.

---

## General Principles

### 1. Be Specific & Efficient
Filter queries as much as possible to reduce unnecessary data retrieval, enhancing speed and relevance. Always use precise filters to target only the data needed.

### 2. Understand Collection Purposes
Familiarize yourself with each collection's purpose, as described in the `database_analysis.md` file. This will help you to select the correct data when responding to queries.

### 3. Decoding Base64 Encoded Keys
In the `property_history` collection, some property keys are encoded in base64. Ensure to decode these encoded keys to extract meaningful information from the `changes` field.

---

## Collection-Specific Guidance

### Cloud Cost and Expense Queries

#### Primary Source:
The `raw_expenses` collection holds detailed cloud cost and usage data.

#### Key Filtering Fields:

##### Cloud Account Identification:
- `cloud_account_id`, `lineItem/UsageAccountId`, `lineItem/UsageAccountName`, `bill/PayerAccountId`, `bill/PayerAccountName`

##### Product & Service Details:
- `lineItem/ProductCode`, `lineItem/LineItemDescription`, `lineItem/LineItemType`, `lineItem/UsageType`

##### Resource and Usage Information:
- `resource_id`, `identity/LineItemId`, `lineItem/UsageAmount`, `lineItem/NormalizedUsageAmount`, `lineItem/UsageStartDate`, `lineItem/UsageEndDate`, `lineItem/UnblendedCost`, `lineItem/BlendedCost`, `lineItem/TaxType`, `lineItem/NormalizationFactor`, `lineItem/CurrencyCode`

##### Time & Period Filters:
- `start_date`, `end_date`, `bill/BillingPeriodStartDate`, `bill/BillingPeriodEndDate`, `identity/TimeInterval`

##### Cost & Pricing Information:
- `cost`, `pricing/publicOnDemandCost`, `lineItem/UnblendedCost`, `lineItem/BlendedCost`

##### Billing & Account Information:
- `bill/BillType`, `bill/BillingEntity`

##### Additional Filters:
- `_rec_n`, `created_at`, `lineItem/LineItemDescription`, `lineItem/UsageAccountName`

#### Pricing Data:
For AWS instance or service pricing, query the `aws_prices` collection using the `sku` field to fetch the required pricing details for various AWS services.

---

### Resource and Asset Queries

#### Primary Source:
The `resources` collection stores information about cloud resources.

#### Key Filtering Fields:

##### Cloud Account Identification:
- `cloud_account_id`: Unique identifier for the cloud account associated with the resource.

##### Resource Identification:
- `cloud_resource_id`: Unique identifier for a specific resource.
- `resource_type`: Category/type of the resource (e.g., Volume, Bucket, Load Balancer etc.).
- `service_name`: Service name tied to the resource (e.g., AmazonEC2, AmazonS3, AWSELB etc.).

##### Resource Lifecycle:
- `first_seen`: Timestamp when the resource was first observed.
- `last_seen`: Timestamp for when the resource was last observed.
- `_first_seen_date`: Date when the resource was first seen.
- `_last_seen_date`: Date when the resource was last seen.

##### Financial Data:
- `last_expense`: Most recent cost associated with the resource.
- `total_cost`: Accumulated cost of the resource over time.

##### Resource Rules and Association:
- `applied_rules`: Compliance checks and rules applied to the resource.
- `pool_id`: The resource pool or group identifier.

##### Employee and User Association:
- `employee_id`: Identifier for the employee or team associated with the resource.

#### Resource Configuration History:
To track resource history, query the `property_history` collection using `cloud_resource_id` or `resource_id`. Ensure to decode any base64 encoded keys in the `changes` field for accurate insights.

---

### Security and Compliance Queries

#### Primary Source for Security Checks:
The `checklists` collection holds data on various cloud security checks, including inactive users, insecure security groups, and obsolete images. The data is organized by modules, each focused on a specific security issue.

#### Key Filtering Fields:

##### **Top-Level Fields (Always Present)**:
- `created_at`: Timestamp when the document was created.
- `module`: The security module (e.g., `inactive_users `, `insecure_security_groups`, `obsolete_images`, `short_living_instances`, `instance_subscription`, `obsolete_snapshots`, `instances_for_shutdown`, `inactive_console_users`, `instance_generation_upgrade`, `abandoned_instances`, `cvos_opportunities`, `rightsizing_instances`, `s3_abandoned_buckets`, `abandoned_kinesis_streams`, `obsolete_ips`, `s3_public_buckets`, `nebius_migration`, `instance_migration`, `rightsizing_rds`, `s3_abandoned_buckets_nebius`, `abandoned_images`, `instances_in_stopped_state_for_a_long_time`, `volumes_not_attached_for_a_long_time`, `obsolete_snapshot_chains`, `reserved_instances` etc.).

- `organization_id`: The organization associated with the check.
- `data`: Array of objects containing detailed information about the security check (structure varies by module).
- `error`: Any error encountered during the security check.
- `options`: Configuration options for the security check.

##### **Fields Inside the `data` Array**:

- **For `inactive_users`**:
- `cloud_account_id`: Cloud account identifier.
- `cloud_type`: Cloud platform type .
- `cloud_account_name`: Cloud account name.
- `user_name`: Inactive user's name.
- `user_id`: Unique user identifier.
- `last_used`: Last activity timestamp.
- `detected_at`: Timestamp when inactivity was detected.

- **For `insecure_security_groups`**:
- `cloud_resource_id`: Cloud resource identifier.
- `resource_name`: Resource name.
- `cloud_account_id`: Cloud account identifier.
- `resource_id`: Resource-specific identifier.
- `cloud_type`: Cloud platform type.
- `cloud_account_name`: Cloud account name.
- `security_group_name`: Name of the security group.
- `security_group_id`: ID of the security group.
- `region`: Cloud region.
- `is_excluded`: Whether the security group is excluded from checks.
- `insecure_ports`: List of insecure ports.
- `detected_at`: Timestamp when the issue was detected.

- **For `obsolete_images`**:
- `cloud_resource_id`: Resource identifier (e.g., image).
- `resource_name`: Resource name (e.g., image name).
- `cloud_account_id`: Cloud account identifier.
- `cloud_type`: Cloud platform type.
- `cloud_account_name`: Cloud account name.
- `first_seen`: Timestamp when the resource was first observed.
- `region`: Cloud region.
- `last_used`: Timestamp when the resource was last used.
- `saving`: Estimated savings from decommissioning.
- `snapshots`: Number of snapshots.
- `detected_at`: Timestamp when the issue was detected.

##### **Common Fields Across All `data` Blocks**:
- `cloud_account_id`: Cloud account identifier.
- `cloud_type`: Cloud platform type.
- `cloud_account_name`: Cloud account name.
- `detected_at`: Timestamp when the issue was detected.

---

### Security Recommendations Archive

#### Overview:
The `archived_recommendations` collection contains historical security recommendations based on previous cloud audits. It provides insights into past recommendations and their outcomes, helping organizations improve their security posture over time.

#### Key Filtering Fields:
To effectively query the `archived_recommendations` collection, the following common filter fields can be used:

- `cloud_account_id`: Unique identifier for the cloud account associated with the recommendation.
- `cloud_type`: The cloud platform type (e.g., AWS, Azure, Google Cloud).
- `module`: The specific security module under which the recommendation falls (e.g., `inactive_users `, `insecure_security_groups`, `obsolete_images`, `short_living_instances`, `instance_subscription`, `obsolete_snapshots`, `instances_for_shutdown`, `inactive_console_users`, `instance_generation_upgrade`, `abandoned_instances`, `cvos_opportunities`, `rightsizing_instances`, `s3_abandoned_buckets`, `abandoned_kinesis_streams`, `obsolete_ips`, `s3_public_buckets`, `nebius_migration`, `instance_migration`, `rightsizing_rds`, `s3_abandoned_buckets_nebius`, `abandoned_images`, `instances_in_stopped_state_for_a_long_time`, `volumes_not_attached_for_a_long_time`, `obsolete_snapshot_chains`, `reserved_instances`etc.).
- `organization_id`: The organization to which the recommendation applies.
- `user_id`: Identifier for the user who made the recommendation or the associated team.
- `cloud_account_name`: The name of the cloud account.
- `description`: A brief description of the security recommendation.
- `detected_at`: The timestamp when the issue was initially detected.
- `last_used`: The timestamp when the recommendation or issue was last accessed or addressed.
- `reason`: The reason behind the recommendation, typically explaining the security risk or opportunity.
- `user_name`: The name of the user associated with the security issue (if applicable).
- `archived_at`: The timestamp when the recommendation was archived.

---

### Webhook and Migration Queries

#### Webhook Logs:
`webhook_logs` and `webhook_observer` track webhook event logs but are currently empty. Data will populate once webhook functionality is active.

#### Database Migrations:
The `database_migrations` collection tracks changes to the database schema. Avoid querying this unless explicitly needed to inspect schema changes.

---

## Best Practices for Querying

### 1. Query Efficiency:
Always filter your queries by as many relevant fields as possible to ensure that the query only returns necessary data. Avoid broad queries that return large datasets unnecessarily.

### 2. Clarity in Field Selection:
Limit the fields you query to only those needed to answer the user’s request. This reduces the load on the database and streamlines the results.

### 3. Base64 Decoding:
In the `property_history` collection, always decode any base64-encoded data from the `changes` field. Failing to decode will result in incomplete or incorrect information.

### 4. Time-based Queries:
When working with time-based data, use specific date filters (e.g., `bill/BillingPeriodStartDate`, `start_date`, `end_date`) to narrow your query's scope. This ensures better performance and more relevant results.

### 5. Handling Empty Fields:
Some collections, such as `checklists`, may contain empty fields (e.g., `data`). Always check for field completeness before making conclusions from these datasets.

---

By adhering to these updated instructions, you will improve your ability to query the `restapi` MongoDB database with greater efficiency, precision, and clarity. This will allow you to respond faster, provide more relevant insights, and ensure optimal performance.