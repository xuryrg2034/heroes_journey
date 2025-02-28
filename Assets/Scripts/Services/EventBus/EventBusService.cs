using System;
using System.Collections.Generic;

namespace Services.EventBus
{
    public static class EventBusService
    {
        private static readonly Dictionary<Actions, Delegate> Events = new();

        // Универсальная подписка (без аргументов и с аргументами)
        public static void Subscribe<T>(Actions eventName, Action<T> callback)
        {
            if (Events.ContainsKey(eventName))
                Events[eventName] = Delegate.Combine(Events[eventName], callback);
            else
                Events[eventName] = callback;
        }

        // Перегрузка для событий без аргументов
        public static void Subscribe(Actions eventName, Action callback)
        {
            Subscribe<object>(eventName, _ => callback());
        }

        // Универсальная отписка
        public static void Unsubscribe<T>(Actions eventName, Action<T> callback)
        {
            if (!Events.ContainsKey(eventName)) return;

            Events[eventName] = Delegate.Remove(Events[eventName], callback);
            if (Events[eventName] == null)
                Events.Remove(eventName);
        }

        // Перегрузка для отписки без аргументов
        public static void Unsubscribe(Actions eventName, Action callback)
        {
            Unsubscribe<object>(eventName, _ => callback());
        }

        // Универсальный вызов события с аргументами
        public static void Trigger<T>(Actions eventName, T param = default)
        {
            if (Events.ContainsKey(eventName) && Events[eventName] is Action<T> action)
                action.Invoke(param);
        }

        // Перегрузка для вызова событий без аргументов
        public static void Trigger(Actions eventName)
        {
            Trigger<object>(eventName, null);
        }
    }
}