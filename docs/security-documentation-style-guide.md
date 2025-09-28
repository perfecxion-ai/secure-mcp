# Security Documentation Style Guide
## Writing Standards for Secure-MCP Documentation Suite

**Version:** 1.0
**Last Updated:** September 27, 2025
**Classification:** Internal - Documentation Standards
**Authority:** Technical Writing Team & Security Leadership

---

## Philosophy and Principles

### The Music of Technical Writing

Remember this fundamental truth about writing: "This sentence has five words. Here are five more words. Five-word sentences are fine. But several together become monotonous. Listen to what is happening. The writing is getting boring. The sound of it drones. It's like a stuck record. The ear demands some variety.

Now listen. I vary the sentence length, and I create music. Music. The writing sings. It has a pleasant rhythm, a lilt, a harmony. I use short sentences. And I use sentences of medium length. And sometimes when I am certain the reader is rested, I will engage him with a sentence of considerable length, a sentence that burns with energy and builds with all the impetus of a crescendo, the roll of the drums, the crash of the cymbals–sounds that say listen to this, it is important."

### Core Writing Principles

**1. Vary Sentence Length Deliberately**
- Short sentences (3-8 words): Create impact and emphasis
- Medium sentences (9-20 words): Carry most information smoothly
- Long sentences (21+ words): Build momentum for important points

**2. Write for Understanding, Not Showing Off**
- Technical accuracy without unnecessary complexity
- Clear explanations that respect reader intelligence
- Active voice that creates energy and clarity

**3. Respect Your Audience's Time**
- Front-load important information
- Use headings that help readers navigate quickly
- Provide executive summaries for lengthy documents

---

## Audience-Specific Writing Standards

### Executive Audience

**Tone:** Authoritative, business-focused, strategic
**Sentence Structure:** Mix of short, impactful statements with longer explanatory sentences
**Focus:** Business impact, financial implications, strategic decisions

**Example - Poor:**
> "The authentication system has vulnerabilities. These vulnerabilities are serious. They could be exploited. This would be bad for business. We need to fix them. The cost is $200K. The ROI is 419%."

**Example - Improved:**
> "Six critical vulnerabilities threaten your authentication system. These aren't theoretical risks—they represent proven attack vectors that skilled adversaries will exploit to compromise customer data and destroy business value. Yet here's what makes this moment extraordinary: the $200K investment required to eliminate these threats delivers 419% ROI while transforming security from liability into competitive weapon."

### Technical Audience

**Tone:** Precise, detailed, implementation-focused
**Sentence Structure:** Longer sentences with technical detail, broken by short clarifying statements
**Focus:** Implementation steps, technical specifications, code examples

**Example - Poor:**
> "JWT validation needs fixing. Use mutex locks. Prevent race conditions. Test thoroughly. Deploy carefully."

**Example - Improved:**
> "JWT validation requires mutex protection to prevent race conditions that enable authentication bypass. Implement async-mutex in the validation service to serialize token verification requests. Short implementation time, critical security impact. This change alone eliminates the highest-severity vulnerability in your system."

### Operations Audience

**Tone:** Clear, procedural, action-oriented
**Sentence Structure:** Step-by-step clarity with occasional longer context sentences
**Focus:** Procedures, troubleshooting, monitoring, maintenance

**Example - Poor:**
> "Monitor security events. Check logs daily. Respond to alerts. Escalate when needed. Document everything."

**Example - Improved:**
> "Monitor security events through three daily checkpoints: 8 AM system health review, 2 PM threat intelligence update, and 6 PM incident status verification. When alerts trigger, you have 15 minutes for initial assessment. Critical incidents require immediate CISO notification—but remember, false alarms damage credibility as much as missed threats damage security."

---

## Standardized Terminology and Usage

### Security Terminology Standards

| **Term** | **Definition** | **Usage Notes** |
|----------|---------------|-----------------|
| **Critical Vulnerability** | CVSS score 9.0-10.0 | Always capitalize "Critical" when referring to CVSS severity |
| **High Vulnerability** | CVSS score 7.0-8.9 | Always capitalize "High" when referring to CVSS severity |
| **CVE** | Common Vulnerabilities and Exposures | Always use full format: "CVE-YYYY-NNNN" |
| **SOC 2** | Service Organization Control 2 | Always include space and "Type I" or "Type II" when applicable |
| **GDPR** | General Data Protection Regulation | No periods in acronym |
| **MFA** | Multi-Factor Authentication | Preferred over "2FA" in formal documentation |
| **RBAC** | Role-Based Access Control | Use full term on first use in each document |
| **API** | Application Programming Interface | Use full term on first use in each document |

### Severity and Risk Language

**Risk Levels (in order):**
1. **Critical** - Immediate action required
2. **High** - Action required within 24 hours
3. **Medium** - Action required within 1 week
4. **Low** - Action required within 1 month

**Financial Impact Language:**
- Use specific dollar amounts when available
- Express ranges with "to" not dashes: "$5M to $10M" not "$5M-$10M"
- Always include context: "annual exposure," "total cost," "implementation investment"

---

## Document Structure Standards

### Standard Document Header

```markdown
# [Document Title]
## [Subtitle if needed]

**Version:** X.X
**Last Updated:** [Month DD, YYYY]
**Classification:** [Internal - Security Sensitive / Internal - Documentation Standards / etc.]
**Target Audience:** [Primary audience - can list multiple]

---
```

### Executive Summary Requirements

Every document longer than 2 pages must include an executive summary that:

1. **Opens with impact**: Start with the most important consequence or opportunity
2. **Provides context**: Explain why this matters now
3. **Outlines solution**: Present clear path forward
4. **States outcomes**: Quantify expected results

### Heading Hierarchy

**Level 1 (#):** Document title only
**Level 2 (##):** Major sections (Executive Summary, Implementation Plan, etc.)
**Level 3 (###):** Subsections within major sections
**Level 4 (####):** Specific procedures or detailed breakdowns
**Level 5 (#####):** Rarely used - only for detailed sub-procedures

### Code and Command Standards

**Inline code:** Use `backticks` for short commands, file names, and technical terms
**Code blocks:** Use fenced code blocks with language specification:

```bash
# Good: Language specified, clear comments
kubectl get pods --all-namespaces | grep secure-mcp
```

**Command outputs:** Include relevant output examples
**Security note:** Never include real passwords, keys, or sensitive data in examples

---

## Content Quality Standards

### Sentence Structure Guidelines

**Vary sentence length intentionally:**
- 25% short sentences (3-8 words) for impact
- 60% medium sentences (9-20 words) for information
- 15% long sentences (21+ words) for complex concepts

**Use active voice:**
- "The security team implemented new controls" not "New controls were implemented"
- "This vulnerability exposes customer data" not "Customer data is exposed by this vulnerability"

**Create smooth transitions:**
- Use transitional phrases: "However," "Additionally," "As a result"
- Reference previous concepts: "This vulnerability, combined with the authentication gaps described above..."
- Build logical progression: Problem → Solution → Outcome

### Technical Writing Best Practices

**Front-load important information:**
- Lead with conclusions in executive documents
- Start procedures with objectives
- Begin technical guides with prerequisites

**Use parallel structure:**
- In lists, keep similar grammatical structure
- In procedures, maintain consistent step format
- In comparisons, align similar elements

**Eliminate unnecessary words:**
- "Due to the fact that" becomes "Because"
- "In order to" becomes "To"
- "It should be noted that" becomes [delete - just state the fact]

---

## Visual and Formatting Standards

### Emphasis and Highlighting

**Bold:** Use for key concepts, important warnings, and document sections
- Example: **Critical vulnerability remediation** requires immediate attention

**Italics:** Use for emphasis within sentences and technical terms on first use
- Example: The *authentication service* handles user verification

**Code formatting:** Use for all technical terms, commands, and file names
- Example: Configure the `jwt-service.ts` file

### Lists and Tables

**Bulleted lists:** For unordered items, features, or benefits
**Numbered lists:** For procedures, priorities, or sequential items
**Tables:** For comparisons, specifications, or structured data

**Table formatting requirements:**
- Include header row
- Left-align text columns
- Right-align numeric columns
- Include units in headers when applicable

### Warning and Alert Formatting

**Critical alerts:**
```markdown
🚨 **CRITICAL:** This vulnerability requires immediate action to prevent data breach.
```

**Important warnings:**
```markdown
⚠️ **WARNING:** Incorrect implementation may compromise system security.
```

**Helpful information:**
```markdown
💡 **TIP:** Enable verbose logging during initial deployment for easier troubleshooting.
```

---

## Review and Quality Assurance

### Content Review Checklist

**Clarity and Flow:**
- [ ] Sentence length varies appropriately for content type
- [ ] Transitions connect ideas smoothly
- [ ] Technical concepts explained clearly
- [ ] Active voice used throughout

**Accuracy and Consistency:**
- [ ] Technical information verified
- [ ] Terminology matches style guide
- [ ] Cross-references accurate
- [ ] Code examples tested

**Audience Appropriateness:**
- [ ] Content matches intended audience
- [ ] Technical level appropriate
- [ ] Business context included when needed
- [ ] Actionable guidance provided

### Editorial Process

**Draft Review (Author):**
1. Complete initial content
2. Review against style guide
3. Check for clarity and flow
4. Verify technical accuracy

**Peer Review (Subject Matter Expert):**
1. Technical accuracy validation
2. Completeness assessment
3. Implementation feasibility
4. Security considerations

**Editorial Review (Technical Writer):**
1. Style guide compliance
2. Sentence structure optimization
3. Flow and readability
4. Formatting consistency

**Final Approval (Document Owner):**
1. Strategic alignment
2. Business impact accuracy
3. Stakeholder review incorporation
4. Publication authorization

---

## Maintenance and Updates

### Version Control

**Version numbering:** X.Y format
- X = Major revisions (structural changes, new sections)
- Y = Minor revisions (content updates, corrections)

**Change documentation:**
- Maintain change log in document
- Note reviewer and approval date
- Archive previous versions

### Regular Review Schedule

**Quarterly:** Content accuracy, link validation, contact information
**Semi-annually:** Structural review, style guide compliance
**Annually:** Comprehensive revision, stakeholder feedback integration

### Feedback Integration

**Collection methods:**
- Embedded feedback forms
- Usage analytics
- Stakeholder surveys
- Support ticket analysis

**Response process:**
- Acknowledge feedback within 48 hours
- Assess impact and priority
- Implement changes within defined timeframes
- Communicate improvements to stakeholders

---

## Examples and Templates

### Executive Summary Template

```markdown
## Executive Summary

[Opening impact statement - what's the biggest consequence or opportunity?]

[Context paragraph - why does this matter now? What's the business situation?]

[Solution overview - what's the clear path forward?]

[Outcome statement - what specific results can stakeholders expect?]

### Key Takeaways

**Immediate Actions Required:**
- [Specific action 1 with timeline]
- [Specific action 2 with timeline]
- [Specific action 3 with timeline]

**Expected Outcomes:**
- [Quantified benefit 1]
- [Quantified benefit 2]
- [Strategic advantage gained]

**Investment Required:** [Specific cost and timeframe]
**Return on Investment:** [Specific ROI calculation with timeframe]
```

### Technical Procedure Template

```markdown
### [Procedure Name]

**Objective:** [What this procedure accomplishes]
**Prerequisites:** [What must be in place first]
**Estimated Time:** [How long this takes]
**Risk Level:** [Low/Medium/High with brief explanation]

#### Step-by-Step Implementation

**Step 1: [Action Name]**
[Detailed instructions with commands/code as needed]

Expected outcome: [What should happen]
Troubleshooting: [Common issues and solutions]

**Step 2: [Action Name]**
[Continue with clear, actionable steps]

#### Validation and Testing

1. [How to verify the implementation worked]
2. [What tests to run]
3. [Success criteria]

#### Rollback Procedure

If implementation fails:
1. [Emergency rollback steps]
2. [How to restore previous state]
3. [Who to contact for support]
```

---

This style guide transforms security documentation from monotonous technical writing into engaging, musical prose that respects readers' time while delivering critical information effectively. Regular application of these standards ensures consistency, clarity, and impact across all security documentation.

**Remember: Write music, not just words. Your readers—and your security posture—deserve nothing less.**