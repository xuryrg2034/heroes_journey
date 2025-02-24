using System;
using Services.Quest;
using UnityEngine;
using UnityEngine.Serialization;

namespace Core.Quest
{
    public abstract class QuestItem : MonoBehaviour
    {
        [SerializeField] private string description;
     
        public Action OnUpdate;
        public Action OnComplete;
        public bool Enable { get; protected set; }

        public bool IsCompleted { get; private set; }

        public string Description => description;

        public virtual void Init()
        {
            Enable = true;
        }

        public abstract string GetProgress();
        
        public abstract void OnCheckCondition<T>(T input = default);
        
        protected void _setIsComplete(bool value)
        {
            IsCompleted = value;
        }
    }
}