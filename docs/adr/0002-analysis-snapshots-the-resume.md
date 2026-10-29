# An Analysis stores a snapshot of the resume text it used

An Analysis copies the resume text (and the resume's label) at the time it runs instead of pointing at the live resume. Resumes are edited and deleted, and an old cover letter or tailored resume must stay faithful to what was actually analysed; deleting a resume must not destroy history. We accept the extra storage (a resume is a few kilobytes) over referencing by id, which would let later edits silently change what an old result meant. Changing this after Analyses exist would mean inventing history that was never stored.
