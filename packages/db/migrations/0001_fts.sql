-- Full-text index over message metadata (no bodies). rowid = messages.rowid.
CREATE VIRTUAL TABLE `messages_fts` USING fts5(
	subject, from_name, from_email, to_addr, snippet,
	tokenize = 'unicode61 remove_diacritics 2',
	prefix = '2 3'
);
