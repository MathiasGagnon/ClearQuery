# VS Code Internal Query Platform — Implementation Plan

## Goal

Build an internal VS Code extension that allows analysts and developers to:

1. Import Excel/CSV files
2. Apply lightweight single-table transformations
3. Save reusable transformation recipes
4. Use transformed datasets as parameters inside SQL templates
5. Execute generated SQL against MariaDB
6. View/export results
7. Re-run projects outside VS Code with a single click

The system is intentionally:

* local-first
* project-based
* SQL-template driven
* MariaDB-native
* reproducible
* Git-friendly

The system is NOT:

* a full ETL orchestration platform
* a generic no-code BI tool
* a replacement for enterprise orchestration systems

---

# Core Principles

## 1. SQL-first

Final execution is always native MariaDB SQL.

The tool generates SQL but does not hide SQL.

## 2. Declarative projects

All project state is stored in files.

No hidden VS Code state.

Projects must be runnable outside the extension.

## 3. Single-table transformations only (v1)

The transformation engine supports only:

* typing
* renaming
* filtering
* unique/deduplication
* computed columns
* sorting

No joins in v1.

## 4. MariaDB remains source of truth

The tool does not replace the operational database.

## 5. Generated artifacts are inspectable

Users can:

* inspect generated SQL
* inspect recipes
* inspect outputs

---

# High-Level Architecture

```text
VS Code Extension UI
    ↓
Project Engine
    ↓
Recipe Engine
    ↓
Dataset Materialization
    ↓
SQL Template Engine
    ↓
MariaDB Execution Engine
    ↓
Result Output Engine
```

---

# Technology Stack

## VS Code Extension

### Language

* TypeScript

### UI

* React
* VS Code Webview API

### Responsibilities

* project explorer
* dataset preview
* recipe editor
* SQL template editor
* query execution
* result viewer
* export actions

---

## Backend Runtime

### Language

* Python 3.11+

### Responsibilities

* file loading
* dataframe transformations
* recipe execution
* SQL rendering
* MariaDB execution
* exports

---

## Python Libraries

### Data

* pandas
* pyarrow
* openpyxl

### SQL

* SQLAlchemy
* pymysql
* Jinja2

### Validation

* pydantic

### Optional later

* polars

---

# Project Structure

```text
project/
│
├── workspace.json
│
├── sources/
│   ├── students.xlsx
│   └── params.csv
│
├── recipes/
│   └── students.recipe.json
│
├── datasets/
│   └── students.parquet
│
├── templates/
│   └── report.sql.j2
│
├── outputs/
│   ├── report.csv
│   └── report.xlsx
│
├── temp/
│
├── scripts/
│   └── run_project.py
│
└── run.bat
```

---

# Project Metadata

## workspace.json

Example:

```json
{
  "name": "student-report-project",
  "version": "1.0",
  "mariadb_connection": {
    "host": "localhost",
    "port": 3306,
    "database": "registraire",
    "user": "user"
  },
  "datasets": [
    {
      "name": "students",
      "source": "sources/students.xlsx",
      "recipe": "recipes/students.recipe.json",
      "output": "datasets/students.parquet"
    }
  ],
  "queries": [
    {
      "name": "student_report",
      "template": "templates/report.sql.j2",
      "output": "outputs/report.xlsx"
    }
  ]
}
```

---

# Dataset Import Engine

## Supported Inputs (v1)

### Excel

* .xlsx

### CSV

* .csv

---

# Transformation Recipe Engine

## Supported Operations (v1)

### set_type

```json
{
  "type": "set_type",
  "column": "student_id",
  "dtype": "string"
}
```

### rename_column

```json
{
  "type": "rename_column",
  "from": "Code",
  "to": "student_code"
}
```

### filter

```json
{
  "type": "filter",
  "expression": "status == 'ACTIVE'"
}
```

### unique

```json
{
  "type": "unique",
  "columns": ["student_id"]
}
```

### computed_column

```json
{
  "type": "computed_column",
  "name": "session_year",
  "expression": "session.str[:4]"
}
```

---

# Materialized Dataset Layer

## Internal Format

Use Parquet internally.

Reason:

* preserves types
* faster reloads
* smaller storage
* dataframe-native

---

# SQL Template System

## Template Format

Use Jinja2 templates.

Example:

```sql
SELECT
    e.code_permanent,
    e.nom,
    e.prenom
FROM etudiant e
JOIN temp_students t
    ON e.code_permanent = t.code_permanent
WHERE e.session = '{{ session }}'
```

---

# Dataset Injection Strategy

## IMPORTANT

Do NOT inline large IN lists.

Instead:

1. create temporary MariaDB tables
2. upload dataset rows
3. join against temp table

Example:

```sql
JOIN temp_students t
    ON e.code_permanent = t.code_permanent
```

---

# Temporary Table Lifecycle

## Process

1. create temp table
2. upload dataframe
3. execute query
4. destroy temp table

---

# SQL Rendering Flow

## Critical Requirement: Fully Reproducible Generated SQL

Every execution must generate a complete SQL artifact representing EVERYTHING executed against MariaDB.

This includes:

* temporary table creation
* temporary table inserts
* cleanup statements
* rendered query templates
* parameter substitutions
* session setup statements

The generated SQL artifact must be:

* human-readable
* executable manually
* exportable
* stored in the project
* reproducible outside the tool

The purpose is:

* disaster recovery
* debugging
* auditing
* long-term maintainability
* independence from the extension/runtime

If the VS Code extension disappears or breaks permanently, a user must still be able to:

1. open the generated SQL file
2. copy/paste into DBeaver/DataGrip/etc.
3. execute successfully

---

## Generated SQL Output Structure

Store generated SQL under:

```text
project/generated_sql/
```

Example:

```text
generated_sql/
├── 2026-05-20_14-32-01_student_report.sql
└── latest_student_report.sql
```

---

## SQL Generation Requirements

The generated SQL file must contain:

### 1. Temporary Table DDL

Example:

```sql
CREATE TEMPORARY TABLE temp_students (
    code_permanent VARCHAR(50)
);
```

---

### 2. Dataset Inserts

Example:

```sql
INSERT INTO temp_students (code_permanent)
VALUES
('ABC123'),
('DEF456');
```

---

### 3. Final Rendered Query

Example:

```sql
SELECT
    e.code_permanent,
    e.nom
FROM etudiant e
JOIN temp_students t
    ON e.code_permanent = t.code_permanent;
```

---

### 4. Cleanup Statements

Example:

```sql
DROP TEMPORARY TABLE IF EXISTS temp_students;
```

---

## Important Constraint

The generated SQL must NOT depend on:

* Python runtime state
* hidden variables
* extension memory
* external serialization formats
* internal dataframe references

Everything necessary for execution must exist directly in the SQL file.

---

## Recommended SQL File Layout

```sql
-- =====================================================
-- Generated by Internal Query Tool
-- Project: student-report-project
-- Query: student_report
-- Timestamp: 2026-05-20 14:32:01
-- =====================================================

-- =====================================================
-- Temporary Tables
-- =====================================================

CREATE TEMPORARY TABLE temp_students (
    code_permanent VARCHAR(50)
);

INSERT INTO temp_students (code_permanent)
VALUES
('ABC123'),
('DEF456');

-- =====================================================
-- Main Query
-- =====================================================

SELECT
    e.code_permanent,
    e.nom
FROM etudiant e
JOIN temp_students t
    ON e.code_permanent = t.code_permanent;

-- =====================================================
-- Cleanup
-- =====================================================

DROP TEMPORARY TABLE IF EXISTS temp_students;
```

---

## Execution Modes

### Mode 1 — Tool Execution

Tool:

1. generates SQL
2. saves SQL artifact
3. executes SQL automatically
4. exports results

---

### Mode 2 — Manual Execution

User:

1. opens generated SQL file
2. copies SQL into DBeaver/DataGrip/etc.
3. runs manually

This mode must always remain supported.

---

## Architectural Principle

Generated SQL is considered a first-class artifact.

The SQL file is NOT merely a debug log.

It is an official portable representation of execution behavior.

---

## Important Future Consideration

Potentially support:

```sql
START TRANSACTION;
...
COMMIT;
```

around generated SQL execution.

This should be optional depending on workload characteristics.

---

## Recommended Metadata Header

Include:

* project name
* query name
* execution timestamp
* source datasets used
* source file hashes
* MariaDB target database
* tool version

This greatly improves reproducibility and debugging.

---

```text
Load template
    ↓
Validate parameters
    ↓
Materialize datasets
    ↓
Create temp tables
    ↓
Render Jinja template
    ↓
Execute MariaDB query
    ↓
Fetch results
```

---

# VS Code UI Design

## Main Views

### 1. Project Explorer

Displays:

* sources
* recipes
* datasets
* templates
* outputs

---

### 2. Dataset Preview

Features:

* preview rows
* inspect types
* row counts
* column stats

---

### 3. Recipe Builder

Operations:

* set type
* rename
* filter
* unique
* computed column

Displays generated recipe JSON.

---

### 4. SQL Template Editor

Features:

* syntax highlighting
* parameter detection
* generated SQL preview
* run button

---

### 5. Result Viewer

Features:

* paginated results
* export CSV
* export Excel
* copy table

---

### 6. Database Explorer

Features:

* browse MariaDB schemas
* inspect tables
* inspect columns
* run ad hoc SQL

IMPORTANT:
Do NOT attempt to fully replace DBeaver/DataGrip.

Keep this lightweight.

---

# Backend APIs

## Extension → Python Runtime

Use subprocess initially.

Later optionally move to FastAPI.

---

## Example Commands

### Run Recipe

```text
python run_recipe.py project_path dataset_name
```

### Run Query

```text
python run_query.py project_path query_name
```

---

# Output Engine

## Supported Outputs

### CSV

### Excel

### Table Preview

---

# Re-Runnable Project System

## Goal

Allow analysts to:

1. update Excel files
2. double-click run.bat
3. regenerate all outputs

without opening VS Code.

---

# run.bat

```bat
@echo off
python scripts/run_project.py
pause
```

---

# run_project.py Responsibilities

1. load workspace.json
2. execute all recipes
3. materialize datasets
4. upload temp tables
5. execute queries
6. export outputs
7. log execution

---

# Logging

## Required

### Execution logs

* start/end times
* rows processed
* query execution time
* output files generated

### Error logs

* SQL failures
* invalid recipes
* file read issues

---

# Validation Rules

## Recipes

Validate:

* referenced columns exist
* dtype compatibility
* expressions compile

---

## SQL Templates

Validate:

* all parameters provided
* dataset references valid
* template renders successfully

---

# Security

## Internal tool assumptions

Tool is internal-only.

Still enforce:

* parameter escaping
* safe query rendering
* no arbitrary shell execution

---

# Future Features (Post-MVP)

## Potential Additions

### Dataset joins

### Query caching

### Saved parameter presets

### Scheduled execution

### Power BI export

### Multiple DB connectors

* PostgreSQL
* SQL Server
* Snowflake

### Shared template registry

### Project packaging

### CLI mode

---

# Non-Goals (Important)

The system should NOT attempt to become:

* Airflow
* Talend
* Power Query clone
* KNIME
* Alteryx
* dbt replacement

Keep scope tightly focused.

---

# Recommended MVP Order

## Phase 1

* project format
* CSV/Excel import
* recipe engine
* parquet materialization

---

## Phase 2

* Jinja SQL templates
* MariaDB execution
* result export

---

## Phase 3

* VS Code extension UI
* dataset preview
* recipe editor
* query runner

---

## Phase 4

* project rerun system
* run.bat generation
* execution logs

---

## Phase 5

* temp table optimizations
* query preview
* parameter presets
* lightweight DB explorer

---

# Key Architectural Decisions

## Keep transformations simple

Single-table only in v1.

---

## SQL templates are source-controlled

Do not store templates in hidden extension state.

---

## MariaDB executes final query

Do not introduce unnecessary execution layers.

---

## Projects are portable

Everything required to rerun exists inside the project folder.

---

## Outputs are reproducible

Given same inputs and same DB state, outputs should be reproducible.

---

# Final Philosophy

The tool should feel like:

* lightweight
* transparent
* reproducible
* SQL-native
* analyst-friendly
* engineering-friendly

The goal is not to hide complexity.

The goal is to make common internal analytics workflows:

* repeatable
* maintainable
* inspectable
* easy to rerun.
