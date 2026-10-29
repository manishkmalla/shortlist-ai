# Shortlist AI

A multi-user assistant that helps a job seeker tailor their own resumes to a job and track their applications, using the user's own Anthropic API key.

## Language

**Profile**:
A user's account details: name, email, chosen model and onboarding progress. It is not a resume.
_Avoid_: base profile, resume profile

**Resume**:
One of a user's own career documents, kept as editable text, plus the original file when it was uploaded.
_Avoid_: CV, profile

**Resume library**:
The set of a user's resumes, at most ten. "My Resumes" is the screen that shows it.
_Avoid_: collection, folder

**Original**:
The file a Resume was uploaded as. It is kept so the user can download it, and is never read by the AI: the Resume's text is.
_Avoid_: source file, attachment

**Default resume**:
The resume pre-selected when the user starts an Analysis. A user with any resumes has exactly one.
_Avoid_: primary resume, main resume

**Reviewed**:
A resume whose text the user has seen and accepted. A resume that is not reviewed cannot be used in an Analysis.
_Avoid_: verified, approved, confirmed

**Application**:
A job the user is pursuing: its job description, company, role, link and tracker status.
_Avoid_: job, listing, analysis

**Analysis**:
One run of the AI pipeline for an Application, using one chosen resume and model, producing the match score, gaps, cover letter and tailored resume. An Application can have several.
_Avoid_: run, report, application

**API key**:
The user's own Anthropic key, which pays for all of their Analyses. The app never supplies one.
_Avoid_: token, secret, credential
