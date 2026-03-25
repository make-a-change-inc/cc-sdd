---
agent: 'agent'
description: Generate comprehensive requirements for a specification
---
<meta>
description: Generate comprehensive requirements for a specification
argument-hint: <feature-name:$1>
</meta>

# Requirements Generation

<background_information>
- **Mission**: Generate comprehensive, testable requirements in EARS format based on the project description from spec initialization, and resolve requirement ambiguity before final document generation
- **Success Criteria**:
  - Create complete requirements document aligned with steering context
  - Follow the project's EARS patterns and constraints for all acceptance criteria
  - Focus on core functionality without implementation details
  - Detect missing or ambiguous specification points before writing final artifacts
  - Resolve ambiguities through interactive one-question-at-a-time dialogue in Copilot Ask Mode
  - Update metadata to track generation status
</background_information>

<instructions>
## Core Task
Generate complete requirements for feature **$1** based on the project description in requirements.md.

When the workflow or user intent requests generation or refinement of `spec.md`, apply the same ambiguity-check and clarification loop, then generate `spec.md` with the clarified decisions reflected.

## Execution Steps

1. **Load Context**:
   - Read `.kiro/specs/$1/spec.json` for language and metadata
   - Read `.kiro/specs/$1/requirements.md` for project description
   - **Load ALL steering context**: Read entire `.kiro/steering/` directory including:
     - Default files: `structure.md`, `tech.md`, `product.md`
     - All custom steering files (regardless of mode settings)
     - This provides complete project memory and context

2. **Read Guidelines**:
   - Read `.kiro/settings/rules/ears-format.md` for EARS syntax rules
   - Read `.kiro/settings/templates/specs/requirements.md` for document structure

3. **Generate Requirements**:
   - Perform a **coverage and ambiguity check** before writing:
     - Identify missing requirement areas, undefined domain terms, unresolved edge cases, conflicting constraints, and unclear acceptance boundaries
     - Create a prioritized clarification list (highest risk first)
   - If ambiguities or gaps are found, start **interactive clarification in Copilot Ask Mode**:
     - Ask exactly **one question at a time**
     - Wait for user response before asking the next question
     - Keep questions concrete and decision-oriented (avoid broad/open-ended prompts)
     - Continue until all blocking ambiguities are resolved or explicitly deferred by user
     - Record each answer as a requirement decision and reflect it in the generated document
   - Create initial requirements based on project description
   - Group related functionality into logical requirement areas
   - Apply EARS format to all acceptance criteria
   - Use language specified in spec.json

4. **Update Metadata**:
   - Set `phase: "requirements-generated"`
   - Set `approvals.requirements.generated: true`
   - Update `updated_at` timestamp

## Important Constraints
- Focus on WHAT, not HOW (no implementation details)
- Requirements must be testable and verifiable
- Choose appropriate subject for EARS statements (system/service name for software)
- If ambiguity exists, do not guess; resolve it via Ask Mode Q&A before final generation
- Ask Mode interaction must be one-question-at-a-time (never batch multiple unresolved questions in one turn)
- Requirement headings in requirements.md MUST include a leading numeric ID only (for example: "Requirement 1", "1.", "2 Feature ..."); do not use alphabetic IDs like "Requirement A".
</instructions>

## Tool Guidance
- **Read first**: Load all context (spec, steering, rules, templates) before generation
- **Write last**: Update requirements.md only after complete generation
- Use **WebSearch/WebFetch** only if external domain knowledge needed

## Output Description
Provide output in the language specified in spec.json with:

1. **Generated Requirements Summary**: Brief overview of major requirement areas (3-5 bullets)
2. **Clarification Log**: List key Ask Mode Q&A decisions incorporated into the document (if any)
3. **Document Status**: Confirm requirements.md and/or spec.md updated and spec.json metadata updated
4. **Next Steps**: Guide user on how to proceed (approve and continue, or modify)

**Format Requirements**:
- Use Markdown headings for clarity
- Include file paths in code blocks
- Keep summary concise (under 300 words)

## Safety & Fallback

### Error Scenarios
- **Missing Project Description**: If requirements.md lacks project description, ask user for feature details
- **Ambiguous Requirements**: Use Ask Mode and ask one clarification question at a time; do not finalize until blocking ambiguities are addressed or explicitly deferred
- **Template Missing**: If template files don't exist, use inline fallback structure with warning
- **Language Undefined**: Default to English (`en`) if spec.json doesn't specify language
- **Incomplete Requirements**: After generation, explicitly ask user if requirements cover all expected functionality
- **Steering Directory Empty**: Warn user that project context is missing and may affect requirement quality
- **Non-numeric Requirement Headings**: If existing headings do not include a leading numeric ID (for example, they use "Requirement A"), normalize them to numeric IDs and keep that mapping consistent (never mix numeric and alphabetic labels).

### Next Phase: Design Generation

**If Requirements Approved**:
- Review generated requirements at `.kiro/specs/$1/requirements.md`
- **Optional Gap Analysis** (for existing codebases):
  - Run `/kiro-validate-gap $1` to analyze implementation gap with current code
  - Identifies existing components, integration points, and implementation strategy
  - Recommended for brownfield projects; skip for greenfield
- Then `/kiro-spec-design $1 -y` to proceed to design phase

**If Modifications Needed**:
- Provide feedback and re-run `/kiro-spec-requirements $1`

**Note**: Approval is mandatory before proceeding to design phase.
