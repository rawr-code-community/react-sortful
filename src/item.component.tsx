import * as React from "react";
import { useGesture } from "react-use-gesture";

import { checkIsInStackableArea, getDropLineDirectionFromXY, getNodeMeta, ItemIdentifier, NodeMeta } from "./shared";
import { ListContext, PlaceholderRendererMeta, StackedGroupRendererMeta } from "./list";
import { GroupContext } from "./groups";
import {
  checkIsAncestorItem,
  clearBodyStyle,
  clearGhostElementStyle,
  getDropLinePositionItemIndex,
  getPlaceholderElementStyle,
  getStackedGroupElementStyle,
  initializeGhostElementStyle,
  moveGhostElement,
  setBodyStyle,
  setDropLineElementStyle,
} from "./item";

type Props<T extends ItemIdentifier> = {
  /** A unique identifier in all items in a root list. */
  identifier: T;
  /** A unique and sequential index number in a parent group. */
  index: number;
  /**
   * Whether this item contains child items.
   * @default false
   */
  isGroup?: boolean;
  /**
   * Whether child items are not able to move and drag.
   * Stacking and popping will be allowed. Grandchild items will not be affected.
   * @default false
   */
  isLocked?: boolean;
  /**
   * Whether it is impossible to put items on both sides of this item.
   * @default false
   */
  isLonely?: boolean;
  children?: React.ReactNode;
};

export const Item = <T extends ItemIdentifier>(props: Props<T>) => {
  const listContext = React.useContext(ListContext);
  const groupContext = React.useContext(GroupContext);

  const ancestorIdentifiers = [...groupContext.ancestorIdentifiers, props.identifier];
  const isGroup = props.isGroup ?? false;
  const isLocked = (listContext.isDisabled || props.isLocked) ?? false;
  const isLonley = props.isLonely ?? false;

  // Registers an identifier to the group context.
  const childIdentifiersRef = React.useRef<Set<ItemIdentifier>>(new Set());
  React.useEffect(() => {
    groupContext.childIdentifiersRef.current.add(props.identifier);

    return () => {
      groupContext.childIdentifiersRef.current.delete(props.identifier);
    };
  }, []);

  const onDragStart = React.useCallback(
    (element: HTMLElement) => {
      setBodyStyle(document.body, listContext.draggingCursorStyle);
      initializeGhostElementStyle(
        element,
        listContext.ghostWrapperElementRef.current ?? undefined,
        listContext.itemSpacing,
        listContext.direction,
      );

      // Sets contexts to values.
      const nodeMeta = getNodeMeta(
        element,
        props.identifier,
        groupContext.identifier,
        ancestorIdentifiers,
        props.index,
        isGroup,
      );
      listContext.setDraggingNodeMeta(nodeMeta);

      // Calls callbacks.
      listContext.onDragStart?.({
        identifier: nodeMeta.identifier,
        groupIdentifier: nodeMeta.groupIdentifier,
        index: nodeMeta.index,
        isGroup: nodeMeta.isGroup,
      });
    },
    [
      listContext.itemSpacing,
      listContext.direction,
      listContext.onDragStart,
      listContext.draggingCursorStyle,
      groupContext.identifier,
      props.identifier,
      props.index,
      ancestorIdentifiers,
      isGroup,
    ],
  );
  const onDragEnd = React.useCallback(() => {
    clearBodyStyle(document.body);
    clearGhostElementStyle(listContext.ghostWrapperElementRef.current ?? undefined);

    // Calls callbacks.
    const destinationMeta = listContext.destinationMetaRef.current;
    listContext.onDragEnd({
      identifier: props.identifier,
      groupIdentifier: groupContext.identifier,
      index: props.index,
      isGroup,
      nextGroupIdentifier: destinationMeta != undefined ? destinationMeta.groupIdentifier : groupContext.identifier,
      nextIndex: destinationMeta != undefined ? destinationMeta.index : props.index,
    });

    // Resets context values.
    listContext.setDraggingNodeMeta(undefined);
    listContext.setIsVisibleDropLineElement(false);
    listContext.setStackedGroupIdentifier(undefined);
    listContext.hoveredNodeMetaRef.current = undefined;
    listContext.destinationMetaRef.current = undefined;
  }, [listContext.onDragEnd, groupContext.identifier, props.identifier, props.index, isGroup]);

  const onHover = React.useCallback(
    (element: HTMLElement) => {
      // Initialize if the dragging item is this item or an ancestor group of this item.
      const draggingNodeMeta = listContext.draggingNodeMeta;
      const isNeededInitialization =
        draggingNodeMeta == undefined ||
        props.identifier === draggingNodeMeta.identifier ||
        checkIsAncestorItem(draggingNodeMeta.identifier, ancestorIdentifiers);
      if (isNeededInitialization) {
        listContext.setIsVisibleDropLineElement(false);
        listContext.hoveredNodeMetaRef.current = undefined;
        listContext.destinationMetaRef.current = undefined;

        return;
      }

      listContext.setIsVisibleDropLineElement(true);
      listContext.hoveredNodeMetaRef.current = getNodeMeta(
        element,
        props.identifier,
        groupContext.identifier,
        ancestorIdentifiers,
        props.index,
        isGroup,
      );
    },
    [listContext.draggingNodeMeta, groupContext.identifier, props.identifier, props.index, ancestorIdentifiers, isGroup],
  );
  const onMoveForStackableGroup = React.useCallback(
    <T extends ItemIdentifier>(hoveredNodeMeta: NodeMeta<T>) => {
      // Sets contexts to values.
      listContext.setIsVisibleDropLineElement(false);
      listContext.setStackedGroupIdentifier(props.identifier);
      listContext.destinationMetaRef.current = {
        groupIdentifier: props.identifier,
        index: undefined,
      };

      // Calls callbacks.
      listContext.onStackGroup?.({
        identifier: props.identifier,
        groupIdentifier: groupContext.identifier,
        index: props.index,
        isGroup,
        nextGroupIdentifier: hoveredNodeMeta.identifier,
      });
    },
    [listContext.stackableAreaThreshold, listContext.onStackGroup, groupContext.identifier, props.identifier, props.index],
  );
  const onMoveForItems = React.useCallback(
    (draggingNodeMeta: NodeMeta<T>, hoveredNodeMeta: NodeMeta<T>, absoluteXY: [number, number]) => {
      if (isLonley) {
        listContext.setIsVisibleDropLineElement(false);
        listContext.destinationMetaRef.current = undefined;

        return;
      }
      if (draggingNodeMeta.index !== hoveredNodeMeta.index) listContext.setIsVisibleDropLineElement(true);

      const dropLineElement = listContext.dropLineElementRef.current ?? undefined;
      setDropLineElementStyle(dropLineElement, absoluteXY, hoveredNodeMeta, listContext.direction);

      // Calculates the next index.
      const dropLineDirection = getDropLineDirectionFromXY(absoluteXY, hoveredNodeMeta, listContext.direction);
      const nextIndex = getDropLinePositionItemIndex(
        dropLineDirection,
        draggingNodeMeta.index,
        draggingNodeMeta.groupIdentifier,
        hoveredNodeMeta.index,
        hoveredNodeMeta.groupIdentifier,
      );

      // Calls callbacks if needed.
      const destinationMeta = listContext.destinationMetaRef.current;
      const isComeFromStackedGroup =
        destinationMeta != undefined && destinationMeta.groupIdentifier != undefined && destinationMeta.index == undefined;
      if (isComeFromStackedGroup) {
        listContext.onStackGroup?.({
          identifier: props.identifier,
          groupIdentifier: groupContext.identifier,
          index: props.index,
          isGroup,
          nextGroupIdentifier: undefined,
        });
      }

      // Sets contexts to values.
      listContext.setStackedGroupIdentifier(undefined);
      listContext.destinationMetaRef.current = { groupIdentifier: groupContext.identifier, index: nextIndex };
    },
    [
      listContext.direction,
      listContext.onStackGroup,
      groupContext.identifier,
      props.identifier,
      props.index,
      isGroup,
      isLonley,
    ],
  );
  const onMove = React.useCallback(
    (absoluteXY: [number, number]) => {
      const draggingNodeMeta = listContext.draggingNodeMeta;
      if (draggingNodeMeta == undefined) return;
      const hoveredNodeMeta = listContext.hoveredNodeMetaRef.current;
      if (hoveredNodeMeta == undefined) return;

      const hasNoItems = childIdentifiersRef.current.size === 0;
      if (
        isGroup &&
        hasNoItems &&
        checkIsInStackableArea(absoluteXY, hoveredNodeMeta, listContext.stackableAreaThreshold, listContext.direction)
      ) {
        onMoveForStackableGroup(hoveredNodeMeta);
      } else {
        onMoveForItems(draggingNodeMeta, hoveredNodeMeta, absoluteXY);
      }
    },
    [listContext.draggingNodeMeta, listContext.direction, onMoveForStackableGroup, onMoveForItems, isGroup],
  );

  const binder = useGesture({
    onHover: ({ event }) => {
      if (listContext.draggingNodeMeta == undefined) return;

      const element = event?.currentTarget;
      if (!(element instanceof HTMLElement)) return;

      event?.stopPropagation();
      onHover(element);
    },
    onMove: ({ xy }) => {
      if (listContext.draggingNodeMeta == undefined) return;

      // Skips if this item is an ancestor group of the dragging item.
      const hasItems = childIdentifiersRef.current.size > 0;
      const hoveredNodeAncestors = listContext.hoveredNodeMetaRef.current?.ancestorIdentifiers ?? [];
      if (hasItems && checkIsAncestorItem(props.identifier, hoveredNodeAncestors)) return;
      if (props.identifier === listContext.draggingNodeMeta.identifier) return;
      // Skips if the dragging item is an ancestor group of this item.
      if (checkIsAncestorItem(listContext.draggingNodeMeta.identifier, ancestorIdentifiers)) return;

      onMove(xy);
    },
  });
  const draggableBinder = useGesture({
    onDragStart: (state: any) => {
      const event: React.SyntheticEvent = state.event;
      const element = event.currentTarget;
      if (!(element instanceof HTMLElement)) return;

      event.persist();
      event.stopPropagation();

      if (isLocked) return;

      onDragStart(element);
    },
    onDrag: ({ down, movement }) => {
      if (isLocked) return;
      if (!down) return;

      moveGhostElement(listContext.ghostWrapperElementRef.current ?? undefined, movement);
    },
    onDragEnd: () => {
      if (isLocked) return;

      onDragEnd();
    },
  });

  const contentElement = React.useMemo((): JSX.Element => {
    const draggingNodeMeta = listContext.draggingNodeMeta;
    const isDragging = draggingNodeMeta != undefined && props.identifier === draggingNodeMeta.identifier;
    const { renderPlaceholder, renderStackedGroup, itemSpacing, direction } = listContext;

    const rendererMeta: Omit<PlaceholderRendererMeta<any>, "isGroup"> | StackedGroupRendererMeta<any> = {
      identifier: props.identifier,
      groupIdentifier: groupContext.identifier,
      index: props.index,
    };

    let children = props.children;
    if (isDragging && renderPlaceholder != undefined) {
      const style = getPlaceholderElementStyle(draggingNodeMeta, itemSpacing, direction);
      children = renderPlaceholder({ binder, style }, { ...rendererMeta, isGroup });
    }
    if (listContext.stackedGroupIdentifier === props.identifier && renderStackedGroup != undefined) {
      const style = getStackedGroupElementStyle(listContext.hoveredNodeMetaRef.current, itemSpacing, direction);
      children = renderStackedGroup({ binder, style }, rendererMeta);
    }

    const padding: [string, string] = ["0", "0"];
    if (direction === "vertical") padding[0] = `${itemSpacing / 2}px`;
    if (direction === "horizontal") padding[1] = `${itemSpacing / 2}px`;

    return (
      <div
        style={{ boxSizing: "border-box", position: "static", padding: padding.join(" ") }}
        {...binder()}
        {...draggableBinder()}
      >
        {children}
      </div>
    );
  }, [
    listContext.draggingNodeMeta,
    listContext.renderPlaceholder,
    listContext.renderStackedGroup,
    listContext.stackedGroupIdentifier,
    listContext.itemSpacing,
    listContext.direction,
    groupContext.identifier,
    props.identifier,
    props.children,
    props.index,
    isGroup,
    binder,
    draggableBinder,
  ]);
  if (!isGroup) return contentElement;

  return (
    <GroupContext.Provider value={{ identifier: props.identifier, ancestorIdentifiers, childIdentifiersRef }}>
      {contentElement}
    </GroupContext.Provider>
  );
};
