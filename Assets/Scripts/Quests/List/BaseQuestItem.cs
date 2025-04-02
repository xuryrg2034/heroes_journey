using System;
using Services;
using UnityEngine;
using UnityEngine.Events;

namespace Quests
{
    [Serializable]
    public abstract class BaseQuestItem
    {
        [SerializeField] string title;
        [SerializeField] string description;

        protected LevelStatistics LevelStatistics;
     
        [HideInInspector]
        public UnityEvent OnUpdate = new();
        
        [HideInInspector]
        public UnityEvent OnComplete = new();

        public bool IsCompleted { get; set; }

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