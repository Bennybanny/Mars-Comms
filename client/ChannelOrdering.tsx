import React, { useState } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Group } from "../shared/types";

export function ChannelOrdering({
  groups,
  disabled,
  onOrder,
  children,
}: {
  groups: Group[];
  disabled: boolean;
  onOrder: (ids: string[]) => void;
  children: React.ReactNode;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 7 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const ids = groups.map((g) => g.id);
  const clear = () => {
    setActive(null);
    setOver(null);
  };
  const end = ({ active: source, over: target }: DragEndEvent) => {
    clear();
    if (
      disabled ||
      !target ||
      source.id === target.id ||
      !ids.includes(String(source.id)) ||
      !ids.includes(String(target.id))
    )
      return;
    onOrder(
      arrayMove(
        ids,
        ids.indexOf(String(source.id)),
        ids.indexOf(String(target.id)),
      ),
    );
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e) => {
        setActive(String(e.active.id));
        setOver(null);
      }}
      onDragOver={(e) => setOver(e.over ? String(e.over.id) : null)}
      onDragCancel={clear}
      onDragEnd={end}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) =>
            `Picked up ${groups.find((g) => g.id === active.id)?.name ?? "channel"}. Use arrow keys to move.`,
          onDragOver: ({ active, over }) =>
            over
              ? `${groups.find((g) => g.id === active.id)?.name ?? "Channel"}, position ${ids.indexOf(String(over.id)) + 1} of ${ids.length}.`
              : "Outside the channel list.",
          onDragEnd: ({ active, over }) =>
            over
              ? `${groups.find((g) => g.id === active.id)?.name ?? "Channel"} dropped at position ${ids.indexOf(String(over.id)) + 1}.`
              : "Channel order unchanged.",
          onDragCancel: () => "Reordering canceled. Channel order unchanged.",
        },
        screenReaderInstructions: {
          draggable:
            "To reorder a channel, press Space, use arrow keys to move, then Space to drop. Escape cancels.",
        },
      }}
    >
      <SortableContext
        items={ids}
        strategy={rectSortingStrategy}
        disabled={disabled}
      >
        <div
          className={"cards" + (active ? " sorting" : "")}
          data-drop-id={over ?? undefined}
          data-drag-id={active ?? undefined}
        >
          {children}
        </div>
      </SortableContext>
    </DndContext>
  );
}

export function SortableChannel({
  id,
  name,
  disabled,
  className,
  style,
  children,
}: {
  id: string;
  name: string;
  disabled: boolean;
  className: string;
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
    activeIndex,
    overIndex,
  } = useSortable({ id, disabled });
  return (
    <article
      ref={setNodeRef}
      className={
        className +
        (isDragging ? " dragging" : "") +
        (!isDragging && isOver
          ? activeIndex > overIndex
            ? " drop-before"
            : " drop-after"
          : "")
      }
      style={{
        ...style,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      data-channel-id={id}
    >
      <span className="channel-color-bar" aria-hidden="true" />
      <button
        ref={setActivatorNodeRef}
        className="channel-drag-handle"
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${name}`}
        title="Drag to reorder · touch and hold · Space and arrow keys"
        disabled={disabled}
        onContextMenu={(e) => e.preventDefault()}
      />
      {children}
    </article>
  );
}
