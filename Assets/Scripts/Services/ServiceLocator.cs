using System;
using System.Collections.Generic;
using UnityEngine;

namespace Services
{
    public static class ServiceLocator
    {
        private static readonly Dictionary<Type, object> services = new();

        public static void Register<T>(T service) where T : class
        {
            var type = typeof(T);
            if (services.ContainsKey(type))
            {
                Debug.LogWarning($"Service {type.Name} is already registered. Overwriting...");
            }
            services[type] = service;
        }

        public static T Get<T>() where T : class
        {
            var type = typeof(T);
            if (services.TryGetValue(type, out var service))
            {
                return service as T;
            }
            Debug.LogError($"Service {type.Name} is not registered!");
            return null;
        }

        public static void Unregister<T>() where T : class
        {
            var type = typeof(T);
            if (services.Remove(type))
            {
                Debug.Log($"Service {type.Name} unregistered.");
            }
        }

        public static void Clear()
        {
            services.Clear();
            Debug.Log("ServiceLocator cleared.");
        }
    }

}