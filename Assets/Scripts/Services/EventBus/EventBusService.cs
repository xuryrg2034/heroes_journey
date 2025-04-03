using System;
using System.Collections.Generic;

namespace Services.EventBus
{
    public static class EventBusService
    {
        static readonly Dictionary<GameEvents, Delegate> Events = new();

        public static void Subscribe(GameEvents evt, Action callback)
        {
            Add(evt, callback);
        }

        public static void Subscribe<T>(GameEvents evt, Action<T> callback)
        {
            Add(evt, callback);
        }

        public static void Unsubscribe(GameEvents evt, Action callback)
        {
            Remove(evt, callback);
        }

        public static void Unsubscribe<T>(GameEvents evt, Action<T> callback)
        {
            Remove(evt, callback);
        }

        public static void Trigger(GameEvents evt)
        {
            if (Events.TryGetValue(evt, out var del) && del is Action action)
                action.Invoke();
        }

        public static void Trigger<T>(GameEvents evt, T arg)
        {
            if (Events.TryGetValue(evt, out var del) && del is Action<T> action)
                action.Invoke(arg);
        }

        static void Add(GameEvents evt, Delegate callback)
        {
            if (Events.TryGetValue(evt, out var existing))
                Events[evt] = Delegate.Combine(existing, callback);
            else
                Events[evt] = callback;
        }

        static void Remove(GameEvents evt, Delegate callback)
        {
            if (!Events.ContainsKey(evt)) return;

            Events[evt] = Delegate.Remove(Events[evt], callback);
            if (Events[evt] == null)
                Events.Remove(evt);
        }
    }
}
