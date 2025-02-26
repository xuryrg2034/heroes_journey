using System;
using Core.Entities;
using Cysharp.Threading.Tasks;
using DG.Tweening;
using Grid;
using UnityEngine;

namespace Abilities.Hero
{
    [Serializable]
    public abstract class BaseAbility
    {
        [SerializeField] private string title;

        public string Title => title;
        
        public Core.Entities.Hero Hero { get; private set; }

        protected BaseAbility() {}

        public virtual void Init(Core.Entities.Hero hero)
        {
            Hero = hero;
        }
        
        public abstract void SelectTarget(Entity entity);

        public abstract void Activate();
        
        public abstract void Deactivate();

        public abstract UniTask Execute();

        public abstract void Cancel();
        
        protected void _highlightTarget(Cell cell, bool highlight)
        {
            cell.Highlite(highlight);
        }
        
        protected bool _isInRange(Vector2Int origin, Vector2Int target, int range)
        {
            var dx = Mathf.Abs(origin.x - target.x);
            var dy = Mathf.Abs(origin.y - target.y);

            // Используем челночное расстояние
            return Mathf.Max(dx, dy) <= range;
        }
    }
}