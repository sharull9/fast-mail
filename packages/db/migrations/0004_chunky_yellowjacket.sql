CREATE TABLE IF NOT EXISTS `contacts` (
	`email` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`last_seen` integer NOT NULL,
	`count` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `contacts_search` ON `contacts` (`email`,`name`);