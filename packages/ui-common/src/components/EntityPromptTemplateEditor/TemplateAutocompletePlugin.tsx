import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { List, ListItemButton, ListItemText, Paper } from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { EntityPromptTemplateSyntaxVersion } from "../../api";
import { ENTITY_PROMPT_TEMPLATE_LANGUAGES } from "../../generated/entity-prompt-template-language";
import { $createTemplateSubstitutionNode } from "./TemplateSubstitutionNode";

class SubstitutionOption extends MenuOption {
  constructor(readonly path: string, readonly description: string) {
    super(path);
  }
}
export function TemplateAutocompletePlugin({
  syntaxVersion,
  onMenuVisibilityChange,
}: {
  syntaxVersion: EntityPromptTemplateSyntaxVersion;
  onMenuVisibilityChange: (visible: boolean) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const handleOpen = useCallback(() => setIsOpen(true), []);
  const handleClose = useCallback(() => setIsOpen(false), []);
  const language = ENTITY_PROMPT_TEMPLATE_LANGUAGES[syntaxVersion].authoring;
  const dollarTrigger = useBasicTypeaheadTriggerMatch("$", {
    minLength: 0,
    punctuation: "",
    maxLength: 100,
  });
  const trigger = useCallback<typeof dollarTrigger>(
    (text, lexicalEditor) => {
      const start = text.lastIndexOf(language.openingDelimiter);
      if (start !== -1) {
        const matchingString = text
          .slice(start + language.openingDelimiter.length)
          .trimStart();
        if (
          matchingString === "" ||
          new RegExp(language.inputPathPattern, "u").test(matchingString)
        ) {
          return {
            leadOffset: start,
            matchingString,
            replaceableString: text.slice(start),
          };
        }
      }
      return dollarTrigger(text, lexicalEditor);
    },
    [dollarTrigger, language]
  );
  const options = useMemo(
    () =>
      language.paths
        .filter(
          (path) =>
            query !== null &&
            path.path.toLowerCase().includes(query.toLowerCase())
        )
        .map((path) => new SubstitutionOption(path.path, path.description)),
    [language, query]
  );
  const isVisible = isOpen && options.length > 0;
  useEffect(() => {
    onMenuVisibilityChange(isVisible);
    return () => onMenuVisibilityChange(false);
  }, [isVisible, onMenuVisibilityChange]);
  return (
    <LexicalTypeaheadMenuPlugin
      onOpen={handleOpen}
      onClose={handleClose}
      onQueryChange={setQuery}
      triggerFn={trigger}
      options={options}
      onSelectOption={(option, queryNode, closeMenu) => {
        editor.update(() => {
          if (!queryNode) return;
          const token = $createTemplateSubstitutionNode(
            `${language.openingDelimiter}${option.path}${language.closingDelimiter}`
          );
          queryNode.replace(token);
          token.selectNext();
          closeMenu();
        });
      }}
      menuRenderFn={(
        anchor,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }
      ) =>
        anchor.current && options.length > 0
          ? createPortal(
              <Paper
                elevation={4}
                sx={(theme) => ({
                  maxHeight: 320,
                  overflowY: "auto",
                  // Lexical gives the anchor the caret range's width, which
                  // can be zero. Size the menu independently of that anchor.
                  width: theme.spacing(60),
                  maxWidth: `calc(100vw - ${theme.spacing(4)})`,
                })}
              >
                <List
                  role="listbox"
                  aria-label="Template substitutions"
                  data-testid="template-substitution-suggestions"
                >
                  {options.map((option, index) => (
                    <ListItemButton
                      key={option.key}
                      id={`typeahead-item-${index}`}
                      role="option"
                      aria-selected={selectedIndex === index}
                      selected={selectedIndex === index}
                      ref={(element) => {
                        option.setRefElement(element);
                      }}
                      data-testid="template-substitution-option"
                      data-path={option.path}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      onClick={() => selectOptionAndCleanUp(option)}
                    >
                      <ListItemText
                        primary={option.path}
                        secondary={option.description}
                      />
                    </ListItemButton>
                  ))}
                </List>
              </Paper>,
              anchor.current
            )
          : null
      }
    />
  );
}
