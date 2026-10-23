# Investigate Issue

This slash command is used to investigate a specific issue that the user has reported without making any changes to the codebase.

## Usage
`/investigate <issue_description>`

## Purpose
- Analyze error messages, compilation errors, or runtime issues
- Examine code structure and dependencies
- Identify root causes and potential solutions
- Provide detailed investigation reports
- Suggest next steps for resolution

## Instructions for Claude
When this command is used:
1. **Read and analyze** the issue description provided
2. **Examine relevant files** to understand the context
3. **Identify root causes** by looking at error messages, stack traces, and code structure
4. **Provide a detailed investigation report** with findings
5. **Suggest potential solutions** but DO NOT implement them
6. **Ask clarifying questions** if the issue description is unclear

## Investigation Pattern
1. **Understand the symptoms** - What is the actual error or problem?
2. **Trace the root cause** - Where does the issue originate?
3. **Analyze dependencies** - What related systems or components are involved?
4. **Identify solution approaches** - What are the possible ways to fix this?
5. **Report findings** - Provide a clear summary of the investigation

## Example Usage
- `/investigate compilation errors in the test file`
- `/investigate foreign key constraint violations during cleanup`
- `/investigate why services are not being injected correctly`

The goal is to thoroughly understand the problem before attempting any fixes.