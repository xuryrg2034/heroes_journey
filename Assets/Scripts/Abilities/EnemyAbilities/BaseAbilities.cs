using System;
using Core.Entities;
using Cysharp.Threading.Tasks;
using DG.Tweening;
using UnityEngine;

namespace Abilities.EnemyAbilities
{
    [Serializable]
    public abstract class BaseAbility
    {
        [SerializeField] private bool enable = false;
        [SerializeField] private int order = 100;
        [HideInInspector] public Enemy Owner;

        private State _state = State.Preparing; 
        
        public int Order => order;
        
        public bool Enable
        {   
            get => enable;
            set
            {
                enable = value;
                // OnEnable?.Invoke(enable);
            }
        }

        // public Action<bool> OnEnable;

        public abstract UniTask Execute();
        
        protected BaseAbility() {}
        
        public virtual void Init(Enemy owner)
        {
            Owner = owner;
        }
        
        protected bool _isInRange(Vector2Int origin, Vector2Int target, int range)
        {
            var dx = Mathf.Abs(origin.x - target.x);
            var dy = Mathf.Abs(origin.y - target.y);

            // Используем челночное расстояние
            return Mathf.Max(dx, dy) <= range;
        }
    }

    enum State
    {
        Pending,
        Preparing,
        Exectute,
    }
}