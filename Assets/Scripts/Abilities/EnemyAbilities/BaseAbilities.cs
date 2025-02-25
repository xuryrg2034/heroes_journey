using System;
using Core.Entities;
using DG.Tweening;
using UnityEngine;

namespace Abilities.EnemyAbilities
{
    public abstract class BaseAbility : MonoBehaviour
    {
        [SerializeField] private bool enable = false;
        [SerializeField] private int order = 100;

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

        public abstract Tween Execute();
        
        protected bool _isInRange(Vector2Int origin, Vector2Int target, int range)
        {
            var dx = Mathf.Abs(origin.x - target.x);
            var dy = Mathf.Abs(origin.y - target.y);

            // Используем челночное расстояние
            return Mathf.Max(dx, dy) <= range;
        }
    }
}