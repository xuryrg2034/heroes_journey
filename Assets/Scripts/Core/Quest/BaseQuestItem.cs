using System;
using Services;
using UnityEngine;
using UnityEngine.Events;

namespace Core.Quest
{
    [Serializable]
    public abstract class BaseQuestItem
    {
        [SerializeField] private string title;
        [SerializeField] private string description;

        protected LevelStatistics LevelStatistics;
     
        [HideInInspector]
        public UnityEvent OnUpdate;
        
        [HideInInspector]
        public UnityEvent OnComplete;

        public bool IsCompleted { get; private set; }

        public string Title => title;
        
        public string Description => description;

        public virtual void Init()
        {
            LevelStatistics = ServiceLocator.Get<LevelStatistics>();
        }

        public abstract string GetProgress();
        
        public abstract void OnCheckCondition();
        
        protected void _setIsComplete(bool value)
        {
            IsCompleted = value;
        }
    }
}