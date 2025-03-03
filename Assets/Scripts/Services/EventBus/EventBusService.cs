using System;
using System.Collections.Generic;

namespace Services.EventBus
{
    public static class EventBusService
    {
        private static readonly Dictionary<Actions, Delegate> Events = new();
        private static readonly Dictionary<Actions, Dictionary<Delegate, Delegate>> Wrappers = new(); // Храним оригинальные ссылки

        // Универсальная подписка (работает и с аргументами, и без)
        public static void Subscribe<T>(Actions eventName, Action<T> callback)
        {
            if (!Events.ContainsKey(eventName))
                Events[eventName] = callback;
            else
                Events[eventName] = Delegate.Combine(Events[eventName], callback);
        }

        public static void Subscribe(Actions eventName, Action callback)
        {
            Action<object> wrapper = _ => callback();

            if (!Wrappers.ContainsKey(eventName))
                Wrappers[eventName] = new Dictionary<Delegate, Delegate>();

            Wrappers[eventName][callback] = wrapper; // Сохраняем связь оригинала и обёртки
            Subscribe(eventName, wrapper);
        }

        // Универсальная отписка
        public static void Unsubscribe<T>(Actions eventName, Action<T> callback)
        {
            if (!Events.ContainsKey(eventName)) return;

            Events[eventName] = Delegate.Remove(Events[eventName], callback);
            if (Events[eventName] == null)
                Events.Remove(eventName);
        }

        public static void Unsubscribe(Actions eventName, Action callback)
        {
            if (!Wrappers.ContainsKey(eventName) || !Wrappers[eventName].ContainsKey(callback)) return;

            var wrapper = Wrappers[eventName][callback];
            Unsubscribe(eventName, (Action<object>)wrapper);

            Wrappers[eventName].Remove(callback);
            if (Wrappers[eventName].Count == 0)
                Wrappers.Remove(eventName);
        }

        // Универсальный вызов события
        public static void Trigger<T>(Actions eventName, T param = default)
        {
            if (Events.TryGetValue(eventName, out var del) && del is Action<T> action)
                action.Invoke(param);
        }

        public static void Trigger(Actions eventName)
        {
            Trigger<object>(eventName, null);
        }
    }
}
