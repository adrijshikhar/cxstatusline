import type { ForegroundColorName } from "chalk";
import { Box, Text, useInput, type BoxProps } from "ink";
import { useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";

export interface ListEntry<V = string | number> {
  label: string;
  sublabel?: string;
  disabled?: boolean;
  description?: string;
  value: V;
  props?: BoxProps;
}

interface ListProps<V = string | number> extends BoxProps {
  items: readonly (ListEntry<V> | "-")[];
  onSelect: (value: V | "back", index: number) => void;
  onSelectionChange?: (value: V | "back", index: number) => void;
  initialSelection?: number;
  showBackButton?: boolean;
  color?: ForegroundColorName;
  wrapNavigation?: boolean;
  maxVisibleItems?: number;
}

/** Small keyboard list retained from ccstatusline's Ink shell. */
export function List<V = string | number>({
  items,
  onSelect,
  onSelectionChange,
  initialSelection = 0,
  showBackButton = false,
  color,
  wrapNavigation = true,
  maxVisibleItems,
  ...boxProps
}: ListProps<V>): React.JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(initialSelection);
  const latestOnSelectionChange = useRef(onSelectionChange);
  const displayedItems = useMemo(
    () => showBackButton ? [...items, "-" as const, { label: "← Back", value: "back" as V }] : [...items],
    [items, showBackButton],
  );
  const selectableItems = displayedItems.filter(
    (item): item is ListEntry<V> => item !== "-" && !item.disabled,
  );
  const selectedItem = selectableItems[selectedIndex];
  const firstVisible = maxVisibleItems && selectableItems.length > maxVisibleItems
    ? Math.max(0, Math.min(selectedIndex, selectableItems.length - maxVisibleItems))
    : 0;
  const visibleItems = maxVisibleItems
    ? selectableItems.slice(firstVisible, firstVisible + maxVisibleItems)
    : displayedItems;

  useEffect(() => {
    latestOnSelectionChange.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    setSelectedIndex(Math.min(initialSelection, Math.max(0, selectableItems.length - 1)));
  }, [initialSelection, selectableItems.length]);

  useEffect(() => {
    if (selectedItem) latestOnSelectionChange.current?.(selectedItem.value, selectedIndex);
  }, [selectedIndex, selectedItem]);

  useInput((_, key) => {
    if (!selectableItems.length) return;
    if (key.upArrow) {
      setSelectedIndex((current) => current === 0
        ? (wrapNavigation ? selectableItems.length - 1 : 0)
        : current - 1);
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((current) => current === selectableItems.length - 1
        ? (wrapNavigation ? 0 : selectableItems.length - 1)
        : current + 1);
      return;
    }
    if (key.return && selectedItem) onSelect(selectedItem.value, selectedIndex);
  });

  return (
    <Box flexDirection="column" {...boxProps}>
      {maxVisibleItems && firstVisible > 0 && <Text dimColor>↑ more</Text>}
      {visibleItems.map((item, index) => {
        if (item === "-") return <Text key={`separator-${index}`}> </Text>;
        return (
          <ListItem
            key={item.value as string}
            isSelected={item === selectedItem}
            {...(color && { color })}
            {...(item.disabled !== undefined && { disabled: item.disabled })}
            {...item.props}
          >
            <Text>{item.label}</Text>
            {item.sublabel && <Text dimColor={item !== selectedItem}>{` ${item.sublabel}`}</Text>}
          </ListItem>
        );
      })}
      {maxVisibleItems && firstVisible + visibleItems.length < selectableItems.length && <Text dimColor>↓ more</Text>}
      {selectedItem?.description && (
        <Box marginTop={1} paddingLeft={2}>
          <Text dimColor wrap="wrap">{selectedItem.description}</Text>
        </Box>
      )}
    </Box>
  );
}

interface ListItemProps extends PropsWithChildren, BoxProps {
  isSelected: boolean;
  color?: ForegroundColorName;
  disabled?: boolean;
}

function ListItem({ children, isSelected, color = "green", disabled, ...boxProps }: ListItemProps): React.JSX.Element {
  return (
    <Box {...boxProps}>
      <Text {...(isSelected && { color })} {...(disabled && { dimColor: true })}>
        {isSelected ? "▶  " : "   "}{children}
      </Text>
    </Box>
  );
}
