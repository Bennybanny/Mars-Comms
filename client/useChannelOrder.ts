import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { ChannelOrder } from "../shared/channel-order";
const empty = (): ChannelOrder => ({ groupIds: [], revision: 0 });
export function useChannelOrder(
  userId: string | undefined,
  onError: (message: string) => void,
) {
  const currentUser = useRef(userId);
  currentUser.current = userId;
  const accepted = useRef(empty());
  const [order, setOrder] = useState(empty);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    accepted.current = empty();
    setOrder(empty());
    setPreview(null);
    setSaving(false);
    inFlight.current = false;
  }, [userId]);
  const receive = useCallback((next?: ChannelOrder) => {
    if (next && next.revision >= accepted.current.revision) {
      accepted.current = next;
      setOrder(next);
    }
  }, []);
  const save = async (groupIds: string[]) => {
    if (!userId || inFlight.current) return;
    const owner = userId;
    inFlight.current = true;
    setSaving(true);
    setPreview(groupIds);
    try {
      const next = await api<ChannelOrder>("/me/channel-order", "PUT", {
        groupIds,
      });
      if (currentUser.current === owner) receive(next);
    } catch {
      if (currentUser.current !== owner) return;
      onError(
        "Channel order could not be saved. Your server order has been restored; try again.",
      );
      try {
        const next = await api<ChannelOrder>("/me/channel-order");
        if (currentUser.current === owner) receive(next);
      } catch {
        /* Existing connection status communicates an offline server. */
      }
    } finally {
      if (currentUser.current === owner) {
        inFlight.current = false;
        setSaving(false);
        setPreview(null);
      }
    }
  };
  return { groupIds: preview ?? order.groupIds, receive, save, saving };
}
