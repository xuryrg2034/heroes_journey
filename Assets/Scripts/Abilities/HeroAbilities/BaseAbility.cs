using System;
using Core.Entities;
using DG.Tweening;
using UnityEngine;

namespace Abilities.HeroAbilities
{
    public abstract class BaseAbility : MonoBehaviour
    {
        public abstract void HandleClick(Entity entity);
        
        public abstract string Title { get; }
        
        public abstract void Activate();
        
        public abstract void Deactivate();

        public abstract Tween Execute();

        public abstract void Interrupt();
        
        protected void _highlightEnemy(Entity entity, bool highlight)
        {
            entity.IsSelected = highlight; // Подсветка
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