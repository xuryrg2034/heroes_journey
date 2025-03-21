using System;
using System.Collections.Generic;
using System.Linq;
using Cysharp.Threading.Tasks;
using Entities.Components;
using UnityEngine;

namespace Entities.Player
{
    [Serializable]
    public class ChainingAttack : BaseAbility
    {
        [SerializeField] private int killsToReward;
        [SerializeField] private BaseEntity rainbowCoinPrefab;
        private readonly List<BaseEntity> _selectedEntities = new();

        private EntitySelectionType _availableSelectionType = EntitySelectionType.Neutral;

        private int _totalDamage;
        
        private bool _selectionLocked;
        
        private Animator _animator;
        
        public override void Activate()
        {
            base.Activate();

            ClickHandler.OnEntityClicked.AddListener(SelectTarget);
        }

        public override void Deactivate()
        {
            base.Deactivate();
            
            ClickHandler.OnEntityClicked.RemoveListener(SelectTarget);
            
            _resetSelection();
        }

        // Вся логика выделения противников мутная, стоит потом пройтись свежим взглядом
        public override void SelectTarget(BaseEntity baseEntity)
        {
            if (baseEntity == Hero)
            {
                _resetSelection();
                _totalDamage = 0;
                _updateHeroPower();
                return;
            }

            if (_selectedEntities.Contains(baseEntity))
            {
                _removeEnemiesAfter(baseEntity);
                _totalDamage = _selectedEntities.Sum(item =>
                {
                    if (item.Health.Value == 0)
                    {
                        return 1;
                    }

                    return -item.Health.Value;
                });

                _selectionLocked = _totalDamage < 0;
                _updateHeroPower();
                return;
            }

            var originPosition = _selectedEntities.Count > 0 ? _selectedEntities.Last().transform.position : Hero.transform.position;
            var isInRange = _isInRange(originPosition, baseEntity.transform.position, 1);
            var canSelection = _canSelectionTypeByType(baseEntity);
            
            if (!isInRange || !canSelection || _selectionLocked) return;
            
            // Проверка, что бы нельзя было добавить в цепочку противка у которого больше 0 здоровья, когда нет урона
            if (baseEntity.Health.Value > 0 && _totalDamage <= 0) return;
            
            _selectedEntities.Add(baseEntity);
            _availableSelectionType = baseEntity.SelectionType;
            // _highlightTarget(baseEntity.Cell, true);

            if (baseEntity.Health.Value == 0)
            {
                _totalDamage += 1;
                _selectionLocked = false;
            }
            else
            {
                _totalDamage -= baseEntity.Health.Value;
                _selectionLocked = _totalDamage < 0;
            }

            _updateHeroPower();
        }

        // Вся калькуляция урона отстой
        public override async UniTask Execute()
        {
            await base.Execute();

            var damage = 0;
            var killedEntity = 0;

            foreach (var entity in _selectedEntities)
            {
                var entityHealth = entity.Health.Value;

                await PlayAnimation("Side Attack");
                await entity.Health.TakeDamage(damage);

                if (entityHealth == 0)
                {
                    damage += 1;
                }

                damage -= entityHealth;

                if (entity.Health.IsDead)
                {
                    await Hero.Move(entity.GridPosition, 0.1f);
                    killedEntity += 1;
                }

                // _highlightTarget(targetCell, false);
                
                if (killedEntity == killsToReward) {
                    _checkComboReward();   
                }
            }

            await PlayAnimation("Idle");
            _resetSelection();
        }
        
        public async UniTask PlayAnimation(string animationName)
        {
            Hero.Animator.SetTrigger(animationName);
            
            // Ждём завершения анимации
            await UniTask.WaitUntil(() =>
            {
                var state = Hero.Animator.GetCurrentAnimatorStateInfo(0);
                return state.normalizedTime >= 1.0f;
            });
        }

        public override void Cancel()
        {
            _resetSelection();
        }

        private bool _canSelectionTypeByType(BaseEntity baseEntity)
        {
            if (
                baseEntity.SelectionType == EntitySelectionType.Neutral
                || _availableSelectionType == EntitySelectionType.Neutral
            ) return true;

            return baseEntity.SelectionType == _availableSelectionType;
        }
        
        private void _removeEnemiesAfter(BaseEntity target)
        {
            var index = _selectedEntities.IndexOf(target);
            if (index < 0) return;

            for (var i = _selectedEntities.Count - 1; i > index; i--)
            {
                // _highlightTarget(_selectedEntities[i].Cell, false);
                _selectedEntities.RemoveAt(i);
            }
            
            _availableSelectionType = _selectedEntities.Last().SelectionType;
        }
        
        private void _resetSelection()
        {
            foreach (var entity in _selectedEntities)
            {
                // _highlightTarget(entity.Cell, false);
            }

            _selectedEntities.Clear();
            _availableSelectionType = EntitySelectionType.Neutral;
            _selectionLocked = false;

            _totalDamage = 0;
            _updateHeroPower();
        }

        private void _updateHeroPower()
        {
            Hero.Damage.SetValue(_totalDamage < 0 ? 0 : _totalDamage);
        }
        
        private void _checkComboReward()
        {
            // var excludeCells = _selectedEntities.Select(e => e.Cell).ToList();
            // var gridService = ServiceLocator.Get<GridService>();
            // var cell = gridService.GetRandomCell(excludeCells);
            
            // gridService.SpawnEntity(rainbowCoinPrefab, cell);
        }
    }
}