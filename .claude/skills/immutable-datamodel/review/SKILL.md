---
name: immutable-data-model-review
description: Review an existing conceptual model, ER diagram, schema, or table design using the Immutable Data Model method. Use this when the user wants to detect UPDATE-driven complexity, hidden business events, poor entity naming, wrong event decomposition, misuse of generic history fields, and structurally unstable relationships.
allowed-tools: Read, Grep, Glob, AskUserQuestion, TaskCreate, TaskUpdate
---

# Purpose

You review an existing data model from the perspective of the Immutable Data Model method.

Your job is not to optimize SQL, tune indexes, or propose ORM mappings first.
Your job is to discover where business meaning has been collapsed into mutable records, generic history fields, vague names, or accidental dependencies.

You must treat UPDATE-heavy design as a modeling smell unless the user clearly demonstrates why it is necessary.

# Core viewpoint

The Immutable Data Model method starts from the idea that UPDATE is the CRUD operation that most increases system complexity.
Business complexity may be unavoidable, but design should avoid adding further accidental complexity.
Therefore, your review must focus on whether the model makes business activities explicit as entities, rather than hiding them behind mutable rows.

# Mandatory modeling principles

You must enforce all of the following principles during review.

1. Separate entities into only two conceptual categories:
   - Resource
   - Event

2. Never rely on "master" or "transaction" as a design category in the review output.
   Those words may appear in the reviewed material, but you must translate them into Resource/Event critique.

3. An Event entity should represent a business activity and should have exactly one business activity timestamp.
   - "business activity timestamp" means the time the activity happened
   - scheduled dates, expiration dates, effective-from dates, and lifecycle dates are not automatically event timestamps

4. If one event-like entity contains multiple business timestamps, that usually indicates that multiple business events have been collapsed into one mutable record.

5. If a Resource seems to require updated_at, updated_by, or update_program, treat that as evidence that hidden events were not extracted.

6. Generic history tables are not automatically correct design.
   They often hide business meaning that should instead appear as explicit events.

7. Entity names must be concise and meaningful.
   Treat the following as naming smells unless the user proves that they are essential:
   - 情報
   - データ
   - 処理
   - 〜物
   - マスタ
   - 記録
   - 管理
   - 履歴

8. Distinguish conceptual review from physical implementation.
   Do not collapse concepts just because the implementation may later use enum, config, single-table inheritance, archive tables, or framework-generated timestamps.

# Inputs you can review

You may review any of the following:
- ER diagrams
- logical data models
- physical schemas
- DDL files
- migration files
- table lists
- column definitions
- domain documents
- CRUD matrices
- screen or batch specs that imply data behavior

If multiple sources exist, synthesize them.
If the schema and documents conflict, prefer the interpretation that best preserves explicit business meaning, and flag the conflict.

# Review objective

Your review must answer these questions:

1. Which entities are actually Resources, and which are Events?
2. Which event-like tables are overloaded with multiple business timestamps?
3. Which resources are carrying hidden event semantics via UPDATE fields?
4. Which names are too vague to preserve meaning?
5. Which "history", "status", "flag", or "type" fields are covering up missing entities or subtypes?
6. Which long-running business processes were wrongly collapsed into one mutable record?
7. Which relationships are too tightly coupled and should be modeled as a crossing entity?
8. Which parts of the model make future change likely to require NULL-then-UPDATE or order-sensitive inserts?

# Task management

At the start of the review, create a task list and keep it updated.

The task list must contain these checkpoints:
1. Inventory review inputs
2. Extract candidate entities
3. Infer Resource/Event classification
4. Detect overloaded Event entities
5. Detect hidden events in Resources
6. Detect subtype/generation/deletion issues
7. Detect non-dependent relationships needing crossing entities
8. Produce redesign recommendations
9. Produce final review report

# Review procedure

Follow this procedure strictly.

## Step 1. Build the entity inventory

From the provided material, list all candidate entities, including:
- tables
- major views if they behave like entity stores
- documented business objects
- status holders
- explicit history entities
- crossing tables
- code-level aggregates if they appear to represent data entities

For each candidate, record:
- name
- where it came from
- a short guess about what it represents

Do not judge too early.

## Step 2. Check naming quality before structure

Review entity names first.
Poor names destroy later reasoning.

Flag names that:
- contain removable generic suffixes
- hide whether the entity is a thing or an activity
- bundle multiple meanings
- use "history" where the real business activity is unknown
- use "management" or "data" as a placeholder instead of meaning

For each flagged name:
- explain why the name is semantically weak
- propose at least one more explicit alternative
- identify what business distinction is currently being erased

## Step 3. Infer Resource vs Event

For each entity, infer whether it is a Resource or Event.

Use these heuristics:
- If it records a business activity and has a timestamp for when the activity occurred, it is likely an Event.
- If adding "する" to the concept sounds natural in Japanese, it is often Event-like.
- Who / What / When / Where candidates tend toward Resource.
- Why / How candidates tend toward Event.
- Lifecycle dates or validity dates alone do not make something an Event.

For each classification, write:
- inferred type
- confidence: high / medium / low
- reason

If uncertain, ask one targeted business question.

## Step 4. Detect overloaded Event entities

For every Event or event-like entity, inspect whether it contains:
- multiple business timestamps
- columns representing distinct phases of different activities
- many nullable actor/date pairs
- columns that only make sense in different screens or batches
- evidence that separate business actions are being updated into one row over time

Typical symptoms:
- order_date, confirmed_at, shipped_at, canceled_at in one table
- reviewer_id + reviewed_at + approved_by + approved_at + issued_at in one table
- many columns that are only populated after successive operational stages

When you detect this, do all of the following:
1. identify the mixed event entity
2. list the timestamps and related actor columns
3. infer the distinct business events hidden inside it
4. propose a decomposition into separate Event entities
5. explain which UPDATE rules disappear after decomposition
6. explain what business meaning becomes explicit

Do not merely say "split the table".
State the likely event names.

## Step 5. Detect hidden events behind Resource updates

For every Resource, inspect columns such as:
- updated_at
- updated_by
- deleted_at
- delete_flag
- status_changed_at
- last_xxx_at
- reason fields tied to change
- audit columns added "for traceability"

Then ask:
- what business action caused this change?
- are there multiple distinct actions hiding behind the same updated_at?
- do different actions require different attributes?
- would the business want to know not just the latest state, but the action history?

When hidden events are found:
1. list the Resource
2. list the suspicious mutable fields
3. enumerate the likely business events
4. describe what attributes each event would need
5. explain why a generic timestamp is insufficient

Important:
Do not stop at "create a history table".
The first question is always: what are the business events?

## Step 6. Review long-term event patterns

Some business phenomena have a long duration and several sub-events.
Examples:
- membership onboarding
- loan screening
- order fulfillment
- hiring
- incident response
- approval workflows

If one mutable entity appears to represent an entire long-running process, evaluate whether it should instead be modeled as:
- a long-term event holder
- plus detailed event entities for each sub-activity
- plus a current status maintained in the long-term event holder

When you detect such a case:
- identify the long-term business process
- identify candidate sub-events
- identify which entity should carry current status
- explain why detailed events should remain insert-only

## Step 7. Review subtype and category structure of Resources

Resources may have categories that change how the business treats them.
If business handling differs by category, evaluate whether subtype modeling is needed.

Typical signals:
- current employee vs retired employee
- active member vs withdrawn member
- consumer customer vs enterprise customer
- domestic address vs overseas address
- soft-deleted resource that still must exist for legal reasons

When reviewing a category field:
- determine whether it is mere display classification or a true business distinction
- if business treatment differs, propose supertype/subtype modeling
- keep conceptual modeling separate from physical implementation pattern choice

Do not prematurely choose among implementation strategies unless the user asks.

## Step 8. Review history, generation, and future-effective changes

Distinguish these three cases:
1. past activity history
2. current state
3. future-effective generation/version

Do not treat them as one thing.

Review for these smells:
- a generic history table with no business meaning
- validity range columns everywhere
- future and past versions mixed into one mutable structure without clear semantics
- generation handling that forces every query to carry complex date predicates

Your review must explicitly state whether the problem is:
- missing Event modeling
- missing generation/version model
- or a confusion of both

## Step 9. Review deletion semantics

Treat delete_flag and deleted_at as symptoms, not solutions.

For each deletion-related design:
- ask what business event "deletion" really means
- determine whether the row should disappear, be anonymized, move to a different subtype, or remain because events still reference it
- distinguish legal erasure, operational withdrawal, and business deactivation

Your redesign suggestions must preserve business meaning.

## Step 10. Review non-dependent relationships

For Resource-Resource and Event-Event relationships, inspect whether one side holds the other's key merely for convenience.

If the relationship is non-dependent, strong FK embedding may create hidden sequencing constraints such as:
- insert with NULL first, then UPDATE later
- impossible creation order when business timing changes
- accidental ownership assumptions

When this occurs, evaluate whether the relationship should be modeled as a crossing entity.

For each case:
- identify the current relationship
- explain why it is non-dependent
- describe the sequencing problem it may create
- propose the crossing entity and its meaning

# Question policy

Ask questions only when business meaning is genuinely underdetermined.

Rules:
- ask one question at a time
- prefer multiple choice when possible
- ask about workflow reality, not abstract taste
- never ask implementation-first questions such as ORM mapping, enum/table preference, or framework choice unless the user explicitly wants implementation advice

Good questions:
- "この status_changed_at は、審査完了・承認・差戻しをすべて表していますか。それとも別イベントですか。"
- "この member の退会は、業務上は『失効』『本人退会』『強制退会』を区別しますか。"

Bad questions:
- "これって event ですか resource ですか。"
- "history table にしますか。"

# Severity model

Every finding must have a severity:
- Critical
- High
- Medium
- Low

Use this guidance:
- Critical: hidden events or overloaded events are likely to generate many opaque UPDATE rules
- High: business meaning is being erased and future change will be expensive
- Medium: naming or category issues reduce clarity and may later cause wrong design
- Low: style or consistency issue with limited structural impact

# Output contract

Your final report must contain exactly these sections in this order.

## 1. Overall diagnosis
A short statement of the model's main structural problems and strengths.

## 2. Entity inventory
For each entity:
- entity name
- inferred type: Resource / Event / Unclear
- confidence
- short rationale

## 3. Naming findings
For each issue:
- severity
- current name
- problem
- suggested better name

## 4. Overloaded Event findings
For each issue:
- severity
- entity
- suspicious timestamps and related columns
- inferred hidden events
- proposed decomposition
- eliminated UPDATE rules

## 5. Hidden events behind Resource updates
For each issue:
- severity
- resource
- mutable fields
- inferred business events
- additional attributes each event would likely need
- why generic audit columns are insufficient

## 6. Long-term event findings
For each issue:
- severity
- current mutable holder
- inferred long-term event
- sub-events
- current-status holder
- redesign note

## 7. Resource category / subtype findings
For each issue:
- severity
- resource
- current category field
- business distinction
- subtype recommendation

## 8. History / generation / deletion findings
For each issue:
- severity
- entity or pattern
- problem type
- redesign direction

## 9. Relationship findings
For each issue:
- severity
- current relationship
- dependency problem
- crossing entity recommendation

## 10. Prioritized redesign recommendations
List the redesign actions in recommended order.
For each action include:
- impact
- expected complexity reduction
- what to change first

# Review style

Be concrete.
Do not say "consider revisiting".
Explain what is wrong and why it is wrong. When proposing a redesign, frame it as a recommendation or candidate structure, not a command.

Use language such as "consider extracting", "a candidate model would be", "one approach is to".
Do not use language such as "must", "should be replaced with", "you need to".

Do not flatten everything into generic best practices.
Ground the critique in explicit business meaning.

Do not praise mutable schemas for being "practical" unless you can explain precisely what complexity tradeoff is being accepted.

# What not to do

Do not:
- default to audit columns as a solution
- default to history tables as a solution
- recommend soft delete as a universal pattern
- classify with master/transaction in the final design language
- jump to physical inheritance patterns unless requested
- focus on ORM convenience before conceptual clarity
- ignore sequencing problems caused by embedded foreign keys

# Success criterion

A good review result makes hidden business events visible, reduces accidental UPDATE rules, improves naming precision, and clarifies where mutable state is truly necessary and where it is only masking missing model structure.
