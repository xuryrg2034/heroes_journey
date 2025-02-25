using System;
using System.Collections.Generic;
using Core.Entities;
using Cysharp.Threading.Tasks;
using DG.Tweening;
using Services.Grid;
using Services.Selection;
using UnityEngine;
using UnityEngine.Serialization;

namespace Abilities.HeroAbilities
{
    public class SlashAttack : BaseAbility
    {
        private int _damage = 0;

        private List<Entity> _selectedTargets = new();

        private static List<Vector2Int> _directions = new()
        {
            new Vector2Int(1, 0), // 0° - вправо
            new Vector2Int(1, 1), // 45° - вверх-вправо
            new Vector2Int(0, 1), // 90° - вверх
            new Vector2Int(-1, 1), // 135° - вверх-влево
            new Vector2Int(-1, 0), // 180° - влево
            new Vector2Int(-1, -1), // 225° - вниз-влево
            new Vector2Int(0, -1), // 270° - вниз
            new Vector2Int(1, -1), // 315° - вниз-вправо
        };

        public SlashAttack(Hero owner, string title) : base(owner, title)
        {
            _damage = owner.Damage.Value;
        }
        
        public override void Activate()
        {
            EntityClickHandler.OnEntityClicked += SelectTarget;
        }

        public override void Deactivate()
        {
            EntityClickHandler.OnEntityClicked -= SelectTarget;

            _resetSelection();
        }
        
        public override void SelectTarget(Entity entity)
        {
            var isHero = entity == Owner;
            
            if (isHero)
            {
                _resetSelection();
                return;
            }

            var isInRange = _isInRange(Owner.Cell.Position, entity.Cell.Position, 1);

            if (!isInRange) return;

            _resetSelection();
            
            var targetPositions = _getEntitiesCoords(Owner.Cell.Position, entity.Cell.Position);
            
            foreach (var position in targetPositions)
            {
                var target = GridService.Instance.GetEntityAt(position);
                    
                if (target)
                {
                    _selectEnemy(target);   
                }
            }
        }

        public override async UniTask Execute()
        {
            var sequence = DOTween.Sequence(null);
            var tasks = new List<UniTask>();
            
            foreach (var target in _selectedTargets)
            {
                var task = target.Health.TakeDamage(0 + _damage);
                
                tasks.Add(task);
            }

            // return sequence.ToUniTask();
            
            await UniTask.WhenAll(tasks);
            _resetSelection();
        }
        
        public override void Cancel()
        {
            // throw new NotImplementedException();
        }

        private void _selectEnemy(Entity entity)
        {
            _selectedTargets.Add(entity);
            // _highlightEnemy(entity, true);
        }

        private void _resetSelection()
        {
            foreach (var target in _selectedTargets)
            {
                // _highlightEnemy(target, false);
            }
            
            _selectedTargets.Clear();
        }

        private List<Vector2Int> _getEntitiesCoords(Vector2Int originPos, Vector2Int targetPos)
        {
            var targets = new List<Vector2Int>();
            // Вектор от героя до клика
            var attackVec = targetPos - originPos;
            var angle = Mathf.Atan2(attackVec.y, attackVec.x) * Mathf.Rad2Deg;

            if (angle < 0) angle += 360;

            // Округляем угол до ближайших 45 градусов (8 направлений)
            var index = Mathf.RoundToInt(angle / 45f) % 8;
            var attackDir = _directions[index];
            // Округляем позицию героя до ячеек сетки

            // Центральная ячейка атаки
            var centerCell = originPos + attackDir;
            Vector2Int leftCell, rightCell;

            // Для диагональных направлений берем соседей так, чтобы они вместе с центром формировали "треугольник"
            if (attackDir.x != 0 && attackDir.y != 0)
            {
                leftCell = new Vector2Int(originPos.x + attackDir.x, originPos.y);
                rightCell = new Vector2Int(originPos.x, originPos.y + attackDir.y);
            }
            else // для кардинальных направлений – берём ячейки по перпендикуляру от направления
            {
                if (attackDir.x == 0) // вверх или вниз
                {
                    leftCell = centerCell + Vector2Int.left;
                    rightCell = centerCell + Vector2Int.right;
                }
                else // влево или вправо
                {
                    leftCell = centerCell + Vector2Int.up;
                    rightCell = centerCell + Vector2Int.down;
                }
            }

            targets.Add(centerCell);
            targets.Add(leftCell);
            targets.Add(rightCell);
            
            return targets;
        }
    }
}