"use client";

import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from "@crm/ui/components/input-group";
import { cn } from "@crm/ui/lib/utils";
import type * as React from "react";

function ChatComposer({
	className,
	...props
}: React.ComponentProps<"form">) {
	return (
		<form
			data-slot="chat-composer"
			className={cn("border-t bg-background p-4", className)}
			{...props}
		/>
	);
}

function ChatComposerField({
	className,
	...props
}: React.ComponentProps<typeof InputGroup>) {
	return (
		<InputGroup
			data-slot="chat-composer-field"
			className={cn("h-auto shadow-2xs", className)}
			{...props}
		/>
	);
}

function ChatComposerInput({
	className,
	...props
}: React.ComponentProps<typeof InputGroupTextarea>) {
	return (
		<InputGroupTextarea
			data-slot="chat-composer-input"
			className={cn("max-h-36 min-h-10 py-2.5 text-xs/5", className)}
			{...props}
		/>
	);
}

function ChatComposerFooter({
	className,
	...props
}: Omit<React.ComponentProps<typeof InputGroupAddon>, "align">) {
	return (
		<InputGroupAddon
			data-slot="chat-composer-footer"
			align="block-end"
			className={cn("justify-between gap-3 pt-1", className)}
			{...props}
		/>
	);
}

function ChatComposerHint({
	className,
	...props
}: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="chat-composer-hint"
			className={cn("truncate text-muted-foreground text-xs", className)}
			{...props}
		/>
	);
}

function ChatComposerSubmit({
	children,
	...props
}: React.ComponentProps<typeof InputGroupButton>) {
	return (
		<InputGroupButton
			data-slot="chat-composer-submit"
			type="submit"
			variant="default"
			size="icon-sm"
			{...props}
		>
			{children}
		</InputGroupButton>
	);
}

export {
	ChatComposer,
	ChatComposerField,
	ChatComposerFooter,
	ChatComposerHint,
	ChatComposerInput,
	ChatComposerSubmit,
};
