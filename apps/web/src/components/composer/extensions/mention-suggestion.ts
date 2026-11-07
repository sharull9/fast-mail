import { ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions } from "@tiptap/suggestion";
import { api } from "@/lib/api";
import { MentionList, type MentionListRef } from "./mention-list";
import type { Contact } from "@mailfast/shared";

export function createMentionSuggestion(onUserTagged?: (contact: Contact) => void): Omit<SuggestionOptions, "editor"> {
  return {
    char: "@",
    items: async ({ query }: { query: string }) => {
      try {
        const contacts = await api.contacts(query || "", 8);
        return contacts;
      } catch {
        return [];
      }
    },
    render: () => {
      let component: ReactRenderer<MentionListRef> | null = null;
      let popupElement: HTMLDivElement | null = null;

      const updatePosition = (clientRect?: DOMRect | null) => {
        if (!popupElement || !clientRect) return;
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        const spaceBelow = viewportHeight - clientRect.bottom;
        const left = Math.max(8, Math.min(viewportWidth - 270, clientRect.left));

        if (spaceBelow < 220 && clientRect.top > 220) {
          popupElement.style.left = `${left}px`;
          popupElement.style.bottom = `${viewportHeight - clientRect.top + 6}px`;
          popupElement.style.top = "auto";
        } else {
          popupElement.style.left = `${left}px`;
          popupElement.style.top = `${clientRect.bottom + 6}px`;
          popupElement.style.bottom = "auto";
        }
      };

      return {
        onStart: (props) => {
          component = new ReactRenderer(MentionList, {
            props: {
              items: props.items as Contact[],
              command: (item: { id: string; label: string; email: string }) => {
                props.command(item);
                onUserTagged?.({
                  name: item.label,
                  email: item.email,
                });
              },
            },
            editor: props.editor,
          });

          popupElement = document.createElement("div");
          popupElement.className = "tiptap-mention-portal";
          popupElement.style.position = "fixed";
          popupElement.style.zIndex = "99999";
          popupElement.appendChild(component.element);
          document.body.appendChild(popupElement);

          updatePosition(props.clientRect?.());
        },

        onUpdate(props) {
          if (!component) return;
          component.updateProps({
            items: props.items as Contact[],
            command: (item: { id: string; label: string; email: string }) => {
              props.command(item);
              onUserTagged?.({
                name: item.label,
                email: item.email,
              });
            },
          });
          updatePosition(props.clientRect?.());
        },

        onKeyDown(props) {
          if (props.event.key === "Escape") {
            if (popupElement) {
              popupElement.remove();
              popupElement = null;
            }
            return true;
          }
          return component?.ref?.onKeyDown(props) || false;
        },

        onExit() {
          if (popupElement) {
            popupElement.remove();
            popupElement = null;
          }
          component?.destroy();
          component = null;
        },
      };
    },
  };
}
