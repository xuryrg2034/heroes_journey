using System;
using System.Collections.Generic;

namespace Services
{
    public static class EventBus
    {
        private static readonly Dictionary<string, Delegate> Events = new Dictionary<string, Delegate>();

        public static void Subscribe<T>(string eventName, Action<T> callback)
        {
            if (Events.ContainsKey(eventName))
            {
                Events[eventName] = Delegate.Combine(Events[eventName], callback);
            }
            else
            {
                Events[eventName] = callback;
            }
        }

        public static void Unsubscribe<T>(string eventName, Action<T> callback)
        {
            if (!Events.ContainsKey(eventName)) return;
            
            Events[eventName] = Delegate.Remove(Events[eventName], callback);
            
            if (Events[eventName] == null)
            {
                Events.Remove(eventName);
            }
        }

        public static void Trigger<T>(string eventName, T param)
        {
            if (Events.ContainsKey(eventName) && Events[eventName] is Action<T> action)
            {
                action.Invoke(param);
            }
        }
    }
}