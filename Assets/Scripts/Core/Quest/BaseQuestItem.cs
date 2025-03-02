using System;
using Services.Quest;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.Serialization;

namespace Core.Quest
{
    [Serializable]
    public abstract class BaseQuestItem
    {
        [SerializeField] private string title;
        [SerializeField] private string description;
     
        [HideInInspector]
        public UnityEvent OnUpdate;
        
        [HideInInspector]
        public UnityEvent OnComplete;

        public bool IsCompleted { get; private set; }

        public string Title => title;
        
        public string Description => description;

        public virtual void Init()
        { }

        public abstract string GetProgress();
        
        public abstract void OnCheckCondition<T>(T input = default);
        
        protected void _setIsComplete(bool value)
        {
            IsCompleted = value;
        }
    }
}