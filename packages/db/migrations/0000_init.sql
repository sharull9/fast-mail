CREATE TABLE `kv` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`color` text,
	`unread` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`internal_date` integer NOT NULL,
	`from_name` text NOT NULL,
	`from_email` text NOT NULL,
	`to_addr` text NOT NULL,
	`cc_addr` text NOT NULL,
	`subject` text NOT NULL,
	`snippet` text NOT NULL,
	`label_ids` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messages_thread` ON `messages` (`thread_id`,`internal_date`);--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` text NOT NULL,
	`action` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_at` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `thread_labels` (
	`label_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`last_date` integer NOT NULL,
	PRIMARY KEY(`label_id`, `thread_id`)
);
--> statement-breakpoint
CREATE INDEX `thread_labels_page` ON `thread_labels` (`label_id`,"last_date" DESC);--> statement-breakpoint
CREATE INDEX `thread_labels_thread` ON `thread_labels` (`thread_id`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`last_date` integer NOT NULL,
	`subject` text NOT NULL,
	`snippet` text NOT NULL,
	`senders` text NOT NULL,
	`message_count` integer NOT NULL,
	`unread` integer NOT NULL,
	`starred` integer NOT NULL,
	`important` integer NOT NULL,
	`label_ids` text NOT NULL,
	`complete` integer DEFAULT false NOT NULL
);
